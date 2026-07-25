/**
 * workers/api routes + materializer (ARCHITECTURE §3.1, §7.6, §12). Kept
 * separate from the worker entry (index.ts) so it imports no Workers-only module
 * (`cloudflare:workers`) and can be unit-tested in plain Node. Enqueue-and-
 * return-fast; sensitive bodies must be sealed envelopes; public reads are open,
 * edge-cached, and searched client-side (no query logging).
 */
import { Hono } from 'hono';
import {
	ALG_BROKER_ONESHOT,
	ALG_VAULT_KEYRING,
	isSealedEnvelope,
	maxEnvelopeLen,
	unframeEnvelope,
	MAX_ENVELOPE_LEN
} from '@harborage/worker-lib/envelope';
import {
	BROKER_FRAME_LEN,
	brokerName,
	brokerRef,
	handleRefOf,
	mintInboxToken,
	padPollResponse,
	parseBrokerFrame,
	verifyInboxToken,
	type BrokerFrame
} from '@harborage/worker-lib/broker';
import { requireOnionOrigin } from '@harborage/worker-lib/onion';
import { medicTier } from '@harborage/worker-lib/medical';
import {
	isZoneId,
	MARSHAL_QUORUM_M,
	MARSHAL_QUORUM_MIN_KEYS,
	SIGNAL_TYPES,
	requiresQuorum,
	type BoardView,
	type SignalType
} from '@harborage/worker-lib/liveboard';
import { verifyRoleQuorum, type RoleSignature } from '@harborage/crypto/quorum';
import { SIG_CONTEXT } from '@harborage/crypto/compartments';
import { bandFor, BANDS, TIERS, type Band, type Tier } from '@harborage/worker-lib/capacity';
import { featureAvailable, flagEnabled } from '@harborage/worker-lib/flags';
import { coarseMs, safeLog, statusClass } from '@harborage/worker-lib/safe-log';
import { verifyTurnstile } from '@harborage/worker-lib/turnstile';
import {
	nonceRetentionMs,
	ONE_SHOT_MAX_TTL_MS,
	verifyRequestCredential,
	type CredentialResult
} from '@harborage/worker-lib/cap-cert';
import {
	admitCredential,
	admitOneShot,
	bucketKey,
	broadTiersOk
} from '@harborage/worker-lib/ratelimit';
import type { Compartment } from '@harborage/crypto/compartments';
import { advanceProbation, bandsOf, dedupVerdict, isDhash64 } from '@harborage/worker-lib/archive';
import { assembleBsaExport } from '@harborage/worker-lib/archive';

/** Mirrors the CHECK constraint in migration 0017. */
const DISPUTE_REASONS: readonly string[] = [
	'not_what_it_shows',
	'wrong_place',
	'wrong_date',
	'recycled_media',
	'staged',
	'misattributed',
	'identifies_a_private_person',
	'other_documented'
];
import type { ApiEnv } from '@harborage/worker-lib/types';

/** The subset of CustodyChain this Worker calls. */
interface CustodyChainStub {
	slice(
		anchor: string,
		fromSeq?: number,
		limit?: number
	): Promise<
		{
			seq: number;
			event: string;
			actor_band: string;
			detail: string;
			at_bucket: string;
			record_hash: string;
			prev_hash: string;
		}[]
	>;
}

type Ctx = { Bindings: ApiEnv };

export const app = new Hono<Ctx>();

// Security-header baseline + request logging (matched route + status class + ms).
app.use('*', async (c, next) => {
	const started = Date.now();
	await next();
	c.header('X-Content-Type-Options', 'nosniff');
	c.header('Referrer-Policy', 'no-referrer');
	c.header(
		'Content-Security-Policy',
		"default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
	);
	safeLog('api_request', {
		route: c.req.routePath,
		statusClass: statusClass(c.res.status),
		ms: coarseMs(Date.now() - started)
	});
});

/**
 * The broad rungs of the ladder (§17.6): a global shard and the origin ASN.
 * Keyed off a hash of the connecting IP, which is never logged or persisted —
 * it only picks which shard to charge.
 */
async function broadOk(c: {
	req: { header(name: string): string | undefined; raw: Request };
	env: ApiEnv;
}) {
	const keyHashHex = await bucketKey(c.req.header('CF-Connecting-IP') ?? 'unknown');
	const asn = (c.req.raw as { cf?: { asn?: number } }).cf?.asn;
	return broadTiersOk(c.env, { keyHashHex, asn });
}

/**
 * Per-request credential: self-issued cap-cert + proof of possession, then the
 * per-credential bucket and single-use nonce in one memory-DO call.
 *
 * A cap-cert authorises nothing (see @harborage/crypto/cap-cert). This proves
 * only that the sender holds the key for this compartment and bound this exact
 * request once. Personhood is Turnstile; volume is the ladder above.
 *
 * Every failure is a flat 401 with no detail. Telling a caller which check
 * failed hands an attacker an oracle for probing clock skew and nonce state,
 * and the reason is kept for the safeLog outcome only.
 */
async function credentialOk(
	c: { req: { raw: Request }; env: ApiEnv },
	body: Uint8Array,
	compartment: Compartment
): Promise<{ ok: boolean; outcome: string; certHashHex?: string; oneShot?: boolean }> {
	const result: CredentialResult = await verifyRequestCredential(c.req.raw, body, {
		nowMs: Date.now(),
		compartment
	});
	if (!result.ok) return { ok: false, outcome: result.reason };

	const verdict = await admitCredential(c.env, {
		certHashHex: result.certHashHex,
		nonceHex: result.nonceHex,
		retainMs: nonceRetentionMs({})
	});
	// A certificate whose life is under the one-shot ceiling was almost certainly
	// minted per request. The live board refuses those: its dedup token derives
	// from the certificate hash, so a fresh certificate per heartbeat is a fresh
	// apparent reporter every 45 seconds. The server cannot PROVE a certificate is
	// one-shot (both are ordinary self-issued cap-certs), so this is a heuristic on
	// the claimed TTL, and it is stated as one.
	const ttlMs = result.cert.expiresAtMs - result.cert.issuedAtMs;
	return {
		ok: verdict === 'ok',
		outcome: verdict,
		certHashHex: result.certHashHex,
		oneShot: ttlMs <= ONE_SHOT_MAX_TTL_MS
	};
}

/**
 * The same, for a route served by a PER-REQUEST identity.
 *
 * A SEPARATE FUNCTION, not an optional parameter on credentialOk. A defaulted
 * `{ oneShot?: boolean }` is forgettable, and forgetting it on a brokered route
 * silently restores two things at once: an hour-long reusable credential that
 * links every brokered request it signs, and a fresh Durable Object per request
 * from cap:-addressing. Two names, one grep.
 */
async function oneShotCredentialOk(
	c: { req: { raw: Request }; env: ApiEnv },
	body: Uint8Array,
	compartment: Compartment
): Promise<{ ok: boolean; outcome: string }> {
	const result: CredentialResult = await verifyRequestCredential(c.req.raw, body, {
		nowMs: Date.now(),
		compartment,
		admission: 'one-shot'
	});
	if (!result.ok) return { ok: false, outcome: result.reason };

	const verdict = await admitOneShot(c.env, {
		nonceHex: result.nonceHex,
		retainMs: nonceRetentionMs({})
	});
	return { ok: verdict === 'ok', outcome: verdict };
}

/**
 * Structural checks every brokered route runs BEFORE it touches a binding.
 *
 * Uniform framing is the confidentiality mechanism, not tidiness: every brokered
 * body is exactly one frame in BOTH phases, so an announce and a reveal are
 * indistinguishable by size to anyone watching the connection. That also makes
 * the rule trivially testable with no bindings at all, which is what stops a
 * later credential check from shadowing it (the /api/archive/dedup lesson: with
 * the credential first, a malformed body returned 401 and a test asserting "not
 * 200" passed with the shape rule deleted).
 */
async function brokerBody(c: {
	req: { header(name: string): string | undefined; arrayBuffer(): Promise<ArrayBuffer> };
}): Promise<{ raw: Uint8Array; frame: BrokerFrame } | Response> {
	const ct = c.req.header('content-type') ?? '';
	if (!ct.includes('application/octet-stream'))
		return new Response('sealed envelope required', { status: 415 });
	const declared = Number(c.req.header('content-length') ?? '0');
	if (declared > maxEnvelopeLen(ALG_BROKER_ONESHOT))
		return new Response('too large', { status: 413 });

	const raw = new Uint8Array(await c.req.arrayBuffer());
	// Exact length, not a ceiling. A short frame is not merely malformed: it
	// would reintroduce the size channel the padding exists to close.
	if (raw.length !== BROKER_FRAME_LEN)
		return new Response('sealed envelope required', { status: 400 });
	const framing = unframeEnvelope(raw);
	if (!framing || framing.algId !== ALG_BROKER_ONESHOT)
		return new Response('sealed envelope required', { status: 400 });
	const frame = parseBrokerFrame(raw);
	if (!frame) return new Response('sealed envelope required', { status: 400 });
	return { raw, frame };
}

// --- Sensitive intake: sealed-envelope-only, enqueue-and-return-fast ---------
// POST /api/incidents/register — structural sealed-body enforcement (§17.5).
app.post('/api/incidents/register', async (c) => {
	// 1. Structural: a sealed envelope is application/octet-stream, size-capped.
	//    A plain-JSON or oversize body is rejected before any binding is touched.
	const ct = c.req.header('content-type') ?? '';
	if (!ct.includes('application/octet-stream')) return c.text('sealed envelope required', 415);
	const declared = Number(c.req.header('content-length') ?? '0');
	if (declared > MAX_ENVELOPE_LEN) return c.text('too large', 413);
	const buf = new Uint8Array(await c.req.arrayBuffer());
	if (!isSealedEnvelope(buf)) return c.text('sealed envelope required', 400);

	// 2. Broad rate limit, then the fail-closed flag, then the per-request
	//    credential, then Turnstile. The broad tiers come first so a flood is
	//    throttled before it can spend a KV read or a signature verification.
	if (!(await broadOk(c))) return c.text('slow down', 429);
	if (
		!(await featureAvailable(c.env.FLAGS, 'document_intake', {
			disabledUnderHeightenedThreat: true
		}))
	)
		return c.text('not open', 403);

	const credential = await credentialOk(c, buf, 'document');
	if (!credential.ok) {
		safeLog('credential_rejected', { route: c.req.routePath, outcome: credential.outcome });
		return c.text('credential required', 401);
	}

	if (!(await verifyTurnstile(c.req.header('cf-turnstile-response'), c.env.TURNSTILE_SECRET)))
		return c.text('verification failed', 403);

	// 3. Enqueue only — no D1 write on the hot path. The M2 consumer records the
	//    incident.
	await c.env.MODERATION_BULK.send({ kind: 'incident_register', envelope: buf });
	return c.json({ receipt: crypto.randomUUID() }, 202, { 'cache-control': 'no-store' });
});

// POST /api/evidence/keyring — SEALED-E2E. The body is a keyring of content-key
// copies, each sealed to a DIFFERENT off-platform holder (reporter vault key,
// off-platform custodian, and for tier B an offshore half that every quorum
// needs). The platform binds no key that opens any of them and exposes no
// unwrap endpoint, which is what makes "we cannot produce plaintext" literally
// true of the evidence original rather than a promise.
//
// Turnstile is deliberately NOT re-checked here. Its token is single-use and is
// spent at /api/incidents/register, which gates this whole flow; re-demanding
// one would fail every real submission. The per-request gate is the cap-cert +
// proof of possession plus the rate ladder, same as the media presign routes.
app.post('/api/evidence/keyring', async (c) => {
	// 1. Structural, before any binding is touched: a framed sealed envelope,
	//    size-capped. A plain-JSON or oversize body is refused by construction.
	const ct = c.req.header('content-type') ?? '';
	if (!ct.includes('application/octet-stream')) return c.text('sealed envelope required', 415);
	const declared = Number(c.req.header('content-length') ?? '0');
	if (declared > MAX_ENVELOPE_LEN) return c.text('too large', 413);
	const buf = new Uint8Array(await c.req.arrayBuffer());
	if (!isSealedEnvelope(buf)) return c.text('sealed envelope required', 400);
	// The keyring lane has its own algorithm id, so a body sealed for a different
	// custody class cannot be filed here and inherit this endpoint's claim.
	const framing = unframeEnvelope(buf);
	if (!framing || framing.algId !== ALG_VAULT_KEYRING)
		return c.text('sealed envelope required', 400);

	if (!(await broadOk(c))) return c.text('slow down', 429);
	if (
		!(await featureAvailable(c.env.FLAGS, 'evidence_vault', {
			disabledUnderHeightenedThreat: true
		}))
	)
		return c.text('not open', 403);

	const credential = await credentialOk(c, buf, 'document');
	if (!credential.ok) {
		safeLog('credential_rejected', { route: c.req.routePath, outcome: credential.outcome });
		return c.text('credential required', 401);
	}

	await c.env.MODERATION_BULK.send({ kind: 'evidence_keyring', envelope: buf });
	return c.json({ ok: true }, 202, { 'cache-control': 'no-store' });
});

// --- Report-a-problem (route-to-gate) ---------------------------------------
// POST /api/directory/report — NOT sealed: a report is public, non-personal
// {entity_id, reason_code}. Never auto-hides; only queues for human review.
app.post('/api/directory/report', async (c) => {
	// Read the raw bytes: the proof of possession binds to exactly what arrived,
	// so re-serialising the parsed JSON would break the signature.
	const raw = new Uint8Array(await c.req.arrayBuffer());
	type ReportBody = { entity_id?: unknown; reason_code?: unknown };
	let body: ReportBody | null;
	try {
		body = JSON.parse(new TextDecoder().decode(raw)) as ReportBody;
	} catch {
		body = null;
	}
	if (!body || typeof body.entity_id !== 'string' || typeof body.reason_code !== 'string')
		return c.text('bad request', 400);
	if (!(await broadOk(c))) return c.text('slow down', 429);
	if (
		!(await featureAvailable(c.env.FLAGS, 'directory_intake', {
			disabledUnderHeightenedThreat: true
		}))
	)
		return c.text('not open', 403);

	const credential = await credentialOk(c, raw, 'directory');
	if (!credential.ok) {
		safeLog('credential_rejected', { route: c.req.routePath, outcome: credential.outcome });
		return c.text('credential required', 401);
	}

	if (!(await verifyTurnstile(c.req.header('cf-turnstile-response'), c.env.TURNSTILE_SECRET)))
		return c.text('verification failed', 403);
	// route-to-gate: no reporter identity, no auto-remove.
	await c.env.MODERATION_BULK.send({
		kind: 'directory_report',
		entity_id: body.entity_id,
		reason_code: body.reason_code
	});
	return c.json({ ok: true }, 202, { 'cache-control': 'no-store' });
});

// --- Public reads (open, edge-cached, no query logging) ----------------------
// GET /api/incidents/index — the Cron-materialized public index. Behind
// incidents_publish (fail closed to empty). The client fetches the whole pack
// and filters/searches locally, so there is no per-query server request.
app.get('/api/incidents/index', async (c) => {
	if (!(await flagEnabled(c.env.FLAGS, 'incidents_publish')))
		return c.json({ published: false, incidents: [] }, 200, {
			'cache-control': 'public, max-age=60'
		});
	// Safety-critical reads fail to stale, never dark (ARCHITECTURE §6.5): a
	// materializer/DB blip must not blank the public record with a 500.
	try {
		const { results } = await c.env.DB.prepare('SELECT * FROM incident_public_index').all();
		return c.json({ published: true, incidents: results }, 200, {
			'cache-control': 'public, max-age=300'
		});
	} catch {
		return c.json({ published: true, incidents: [], stale: true }, 200, {
			'cache-control': 'public, max-age=30'
		});
	}
});

// GET /api/notices — published official notices (public-plaintext). Behind
// notices_publish (fail closed to empty). The client verifies each notice's
// m-of-n signature against the on-device signed key directory; the server is
// content-blind about trust. Degrade-safe to an empty list on error.
app.get('/api/notices', async (c) => {
	if (!(await flagEnabled(c.env.FLAGS, 'notices_publish')))
		return c.json({ published: false, notices: [] }, 200, {
			'cache-control': 'public, max-age=60'
		});
	try {
		const { results } = await c.env.DB.prepare(
			`SELECT id, epoch, notice_type, title_i18n, body_i18n, area, payload_hash,
			        signature_set, signer_key_ids, published_at, supersedes, superseded_by
			 FROM notices ORDER BY published_at DESC LIMIT 200`
		).all();
		return c.json({ published: true, notices: results }, 200, {
			'cache-control': 'public, max-age=120'
		});
	} catch {
		return c.json({ published: true, notices: [], stale: true }, 200, {
			'cache-control': 'public, max-age=30'
		});
	}
});

// GET /api/directory/pack — public directory rows. Reads are day-1 core and stay
// open (writes are gated); degrade-safe to an empty pack on error.
app.get('/api/directory/pack', async (c) => {
	try {
		const { results } = await c.env.DB.prepare(
			"SELECT * FROM resource_entries WHERE status = 'LIVE'"
		).all();
		return c.json({ entries: results }, 200, { 'cache-control': 'public, max-age=300' });
	} catch {
		return c.json({ entries: [], stale: true }, 200, { 'cache-control': 'public, max-age=30' });
	}
});

// GET /api/intake/status — public feature-flag booleans so the client can show
// or hide the off-device send / directory-write affordances. Not sensitive.
// Fail-closed to OFF; brief cache. The Workers remain the authoritative gate.
/**
 * Point at a clip that lives somewhere else (ARCHITECTURE §16, §7.3).
 *
 * FINGERPRINT AND REFERENCE ONLY. This route makes NO outbound request — not a
 * disabled one, not one behind a flag: there is no fetch in this handler at
 * all. Re-hosting someone else's media is the counsel-gated source-terms
 * question, and the off-platform egress that would make it safe to attempt does
 * not exist. No URL is stored either, because a URL plus a submission time is a
 * soft link between a submitter and a target.
 */
app.post('/api/archive/import', async (c) => {
	const raw = new Uint8Array(await c.req.raw.clone().arrayBuffer());
	let body: { canonical_content_id?: unknown; dhash64?: unknown };
	try {
		body = JSON.parse(new TextDecoder().decode(raw));
	} catch {
		return c.json({ error: 'bad body' }, 400);
	}
	const id = body.canonical_content_id;
	const dhash = body.dhash64;
	if (typeof id !== 'string' || id.length === 0 || id.length > 200)
		return c.json({ error: 'bad body' }, 400);
	// A URL is not a content id. Refusing it here keeps the "no URL is stored"
	// claim true even if a client sends one by habit.
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(id)) return c.json({ error: 'bad body' }, 400);
	if (typeof dhash !== 'string' || !isDhash64(dhash)) return c.json({ error: 'bad body' }, 400);

	if (!(await broadOk(c))) return c.text('slow down', 429);
	if (
		!(await featureAvailable(c.env.FLAGS, 'source_import', { disabledUnderHeightenedThreat: true }))
	)
		return c.text('not open', 403);

	const credential = await credentialOk(c, raw, 'document');
	if (!credential.ok) {
		safeLog('credential_rejected', { route: c.req.routePath, outcome: credential.outcome });
		return c.text('credential required', 401);
	}

	const [b0, b1, b2, b3] = bandsOf(dhash);
	await c.env.DB.prepare(
		`INSERT INTO archive_source_refs
			(canonical_content_id, dhash64, band0, band1, band2, band3, reference_state, first_seen_bucket)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'REFERENCED', ?7)
		 ON CONFLICT(canonical_content_id) DO NOTHING`
	)
		.bind(id, dhash, b0, b1, b2, b3, new Date().toISOString().slice(0, 10))
		.run();
	return c.json({ ok: true }, 202, { 'cache-control': 'no-store' });
});

/**
 * Dedup: may the client skip uploading this PUBLIC derivative?
 *
 * THE ORACLE THIS ROUTE MUST NOT BE. Answering "do you already hold this?" for
 * one obscure file tells the asker whether that file has been archived, which
 * for a singleton is a fact about one contributor. So `skip` is returned only
 * once a cohort of at least K holders exists; below that the honest answer is
 * `upload`, which costs a redundant upload and buys the absence of the oracle.
 *
 * There is deliberately NO field here for a sealed original's digest, and an
 * unknown field is a 400 rather than something ignored: a body shape that
 * cannot express the question cannot be tricked into answering it. This route
 * never reads the vault and never touches evidence_keyrings.
 */
app.post('/api/archive/dedup', async (c) => {
	// STRUCTURAL FIRST, before any binding is touched, matching the shape of
	// /api/incidents/register. Ordering the credential check first made the
	// shape rule untestable: a malformed body returned 401 rather than 400, so
	// a test asserting "not 200" passed even with the shape rule deleted.
	const raw = new Uint8Array(await c.req.raw.clone().arrayBuffer());
	let body: unknown;
	try {
		body = JSON.parse(new TextDecoder().decode(raw));
	} catch {
		return c.json({ error: 'bad body' }, 400);
	}
	if (typeof body !== 'object' || body === null) return c.json({ error: 'bad body' }, 400);
	const keys = Object.keys(body);
	// Exact shape, not a subset. An extra key is a question we did not agree to
	// answer, and silently ignoring it is how a wider question sneaks in.
	if (keys.length !== 1 || keys[0] !== 'derivative_sha256')
		return c.json({ error: 'bad body' }, 400);
	const sha = (body as { derivative_sha256: unknown }).derivative_sha256;
	if (typeof sha !== 'string' || !/^[0-9a-f]{64}$/.test(sha))
		return c.json({ error: 'bad body' }, 400);

	if (!(await broadOk(c))) return c.text('slow down', 429);
	if (
		!(await featureAvailable(c.env.FLAGS, 'archive_publish', {
			disabledUnderHeightenedThreat: true
		}))
	)
		return c.text('not open', 403);

	const credential = await credentialOk(c, raw, 'document');
	if (!credential.ok) {
		safeLog('credential_rejected', { route: c.req.routePath, outcome: credential.outcome });
		return c.text('credential required', 401);
	}

	const row = await c.env.DB.prepare(
		'SELECT COUNT(*) AS n FROM archive_items WHERE derivative_sha256 = ?1'
	)
		.bind(sha)
		.first<{ n: number }>();
	return c.json({ derivative_held: dedupVerdict(row?.n ?? 0) }, 200, {
		'cache-control': 'no-store'
	});
});

/**
 * A documented objection against an archived item. Append-only: a dispute is an
 * INPUT to review, never an outcome, so nothing here hides or removes anything.
 * Coordinated identical disputes are a coordination signal, not consensus.
 */
app.post('/api/archive/dispute', async (c) => {
	if (!(await broadOk(c))) return c.text('slow down', 429);
	if (
		!(await featureAvailable(c.env.FLAGS, 'archive_publish', {
			disabledUnderHeightenedThreat: true
		}))
	)
		return c.text('not open', 403);

	const raw = new Uint8Array(await c.req.raw.clone().arrayBuffer());
	const credential = await credentialOk(c, raw, 'document');
	if (!credential.ok) {
		safeLog('credential_rejected', { route: c.req.routePath, outcome: credential.outcome });
		return c.text('credential required', 401);
	}

	let body: { original_sha256?: unknown; reason_code?: unknown; evidence_sha256?: unknown };
	try {
		body = JSON.parse(new TextDecoder().decode(raw));
	} catch {
		return c.json({ error: 'bad body' }, 400);
	}
	const anchor = body.original_sha256;
	const reason = body.reason_code;
	if (typeof anchor !== 'string' || !/^[0-9a-f]{64}$/.test(anchor))
		return c.json({ error: 'bad body' }, 400);
	// Closed vocabulary, enforced here as well as by the CHECK constraint: free
	// text beside a public evidence record is how a doxxing payload arrives.
	if (typeof reason !== 'string' || !DISPUTE_REASONS.includes(reason))
		return c.json({ error: 'bad body' }, 400);
	const evidence = typeof body.evidence_sha256 === 'string' ? body.evidence_sha256 : null;
	if (evidence !== null && !/^[0-9a-f]{64}$/.test(evidence))
		return c.json({ error: 'bad body' }, 400);

	await c.env.DB.prepare(
		`INSERT INTO archive_disputes (original_sha256, reason_code, stance, outcome, evidence_sha256, raised_bucket)
		 VALUES (?1, ?2, 'dispute', 'open', ?3, ?4)`
	)
		.bind(anchor, reason, evidence, new Date().toISOString().slice(0, 10))
		.run();
	return c.json({ ok: true }, 202, { 'cache-control': 'no-store' });
});

/**
 * The custody slice for one item, plus an inclusion proof (ARCHITECTURE §7.2).
 *
 * PUBLIC and unauthenticated on purpose: a custody record that only we can read
 * is a custody record nobody can check. Every field is already non-identifying
 * by construction, which is what makes publishing it safe.
 */
app.get('/api/archive/custody/:anchor', async (c) => {
	const anchor = c.req.param('anchor');
	if (!/^[0-9a-f]{64}$/.test(anchor)) return c.json({ error: 'bad anchor' }, 400);
	try {
		const ns = c.env.CUSTODY_CHAIN;
		const stub = ns.get(ns.idFromName(anchor)) as unknown as CustodyChainStub;
		const lines = await stub.slice(anchor);
		return c.json({ anchor, custody: lines }, 200, { 'cache-control': 'public, max-age=300' });
	} catch {
		// Degrade safe: a reader checking a record must not be told the item does
		// not exist merely because a lookup failed.
		return c.json({ anchor, custody: [], stale: true }, 200, {
			'cache-control': 'public, max-age=30'
		});
	}
});

/**
 * The §63 artifact. Behind archive_publish, because it is the surface that makes
 * an item citable. The platform assembles and never signs.
 */
app.get('/api/archive/export/:anchor', async (c) => {
	const anchor = c.req.param('anchor');
	if (!/^[0-9a-f]{64}$/.test(anchor)) return c.json({ error: 'bad anchor' }, 400);
	if (
		!(await featureAvailable(c.env.FLAGS, 'archive_publish', {
			disabledUnderHeightenedThreat: true
		}))
	)
		return c.json({ published: false }, 403);

	const row = await c.env.DB.prepare(
		'SELECT original_sha256, citable_id, original_status, derivative_sha256 FROM archive_items WHERE original_sha256 = ?1'
	)
		.bind(anchor)
		.first<{
			original_sha256: string;
			citable_id: string;
			original_status: string;
			derivative_sha256: string | null;
		}>();
	if (!row) return c.json({ error: 'not found' }, 404);

	const ns = c.env.CUSTODY_CHAIN;
	const stub = ns.get(ns.idFromName(anchor)) as unknown as CustodyChainStub;
	const lines = await stub.slice(anchor);

	return c.json(
		assembleBsaExport({
			anchor,
			citableId: row.citable_id,
			originalStatus: row.original_status,
			derivativeSha256: row.derivative_sha256 ?? undefined,
			custodyLines: lines.map((l) => ({
				seq: l.seq,
				event: l.event,
				actorBand: l.actor_band,
				detail: l.detail,
				atBucket: l.at_bucket,
				recordHash: l.record_hash,
				prevHash: l.prev_hash
			})),
			builtBucket: new Date().toISOString().slice(0, 10)
		}),
		200,
		{ 'cache-control': 'public, max-age=300' }
	);
});

app.get('/api/intake/status', async (c) => {
	const [recordIntake, directoryIntake] = await Promise.all([
		featureAvailable(c.env.FLAGS, 'document_intake', { disabledUnderHeightenedThreat: true }),
		featureAvailable(c.env.FLAGS, 'directory_intake', { disabledUnderHeightenedThreat: true })
	]);
	// The PUBLIC half of the intake sealed-box keypair. Publishing it is the
	// point: a client seals the metadata envelope to it before sending. It is
	// deliberately not pinned into the app shell, because the shell is served
	// from this same edge (§9.5) so pinning would add no protection an attacker
	// who can swap this value could not also defeat. The client pins on first
	// use and warns on change, which is the honest bound.
	//
	// Absent ⇒ no key is published and the client refuses to send. Fail-closed.
	const intakeKey =
		typeof c.env.INTAKE_PUBLIC_KEY === 'string' && /^[0-9a-f]{64}$/.test(c.env.INTAKE_PUBLIC_KEY)
			? c.env.INTAKE_PUBLIC_KEY
			: null;
	// The Turnstile sitekey. Public by construction — it is embedded in the page
	// — so it rides the same open endpoint as the intake public key rather than
	// forcing a build-time substitution into prerendered HTML.
	//
	// Absent ⇒ null ⇒ the client renders no widget and hides the send
	// affordance. Fail-closed, and the Worker refuses the write regardless: this
	// only decides whether the user is shown a control that cannot work.
	const sitekey =
		typeof c.env.TURNSTILE_SITEKEY === 'string' &&
		/^[A-Za-z0-9_-]{8,64}$/.test(c.env.TURNSTILE_SITEKEY) &&
		// An unreplaced CI placeholder must read as "no sitekey", not as one.
		!c.env.TURNSTILE_SITEKEY.startsWith('REPLACE_')
			? c.env.TURNSTILE_SITEKEY
			: null;
	return c.json(
		{
			document_intake: recordIntake,
			directory_intake: directoryIntake,
			intake_key: intakeKey,
			turnstile_sitekey: sitekey
		},
		200,
		{ 'cache-control': 'public, max-age=30' }
	);
});

// --- Brokered mutual aid (PRD §4.8, §4.9; ARCHITECTURE §5.3) -----------------
//
// Four routes, one shape. Every body is EXACTLY one frame in both the announce
// and the reveal phase, so the two are indistinguishable by size. The Broker and
// Mailbox are memory-only and content-blind; the platform holds no key that
// opens anything relayed here.
//
// NO safeLog OUTCOME ON THESE ROUTES, and on the poll route no safeLog at all
// beyond the middleware's route + status class + coarse ms. gate-safelog would
// allow an `outcome` field, but on the poll route any value distinguishing
// delivered from empty writes into Cloudflare's logs exactly the bit the padding
// spends 4 KiB per poll to hide.

/** Broker stub surface, narrowed to what this Worker calls. */
interface BrokerStub {
	openNeed(
		input: { category: string; commit: Uint8Array; seekerInbox: string; handle: Uint8Array },
		nowMs?: number
	): Promise<{ handleHex: string } | 'full' | 'bad-input'>;
	claimNeed(
		helperInbox: string,
		category: string,
		nowMs?: number
	): Promise<{ handleHex: string; commit: Uint8Array } | null>;
	accept(
		handleHex: string,
		helperInbox: string,
		frame: Uint8Array,
		nowMs?: number
	): Promise<'ok' | 'taken' | 'unknown' | 'capped' | 'bad-frame'>;
	reveal(handleHex: string, preimage: Uint8Array, nowMs?: number): Promise<Uint8Array | null>;
	keepalive(nowMs?: number): Promise<void>;
}

interface MailboxStub {
	deliver(frame: Uint8Array, nowMs?: number): Promise<'ok' | 'full' | 'bad-frame'>;
	poll(nowMs?: number): Promise<Uint8Array | null>;
}

function randomBytes(n: number): Uint8Array {
	const b = new Uint8Array(n);
	crypto.getRandomValues(b);
	return b;
}

/** The gate every aid route passes after its structural check. */
async function aidGate(
	c: { req: { raw: Request; header(name: string): string | undefined }; env: ApiEnv },
	raw: Uint8Array
): Promise<Response | null> {
	if (!(await broadOk(c))) return new Response('slow down', { status: 429 });
	if (!(await featureAvailable(c.env.FLAGS, 'aid_broker', { disabledUnderHeightenedThreat: true })))
		return new Response('not open', { status: 403 });
	const credential = await oneShotCredentialOk(c, raw, 'aid');
	if (!credential.ok) return new Response('credential required', { status: 401 });
	return null;
}

/** POST /api/aid/need — announce an open need, or reveal against an accepted one. */
app.post('/api/aid/need', async (c) => {
	const body = await brokerBody(c);
	if (body instanceof Response) return body;
	const refused = await aidGate(c, body.raw);
	if (refused) return refused;
	if (!(await verifyTurnstile(c.req.header('cf-turnstile-response'), c.env.TURNSTILE_SECRET)))
		return c.text('verification failed', 403);

	const ref = await brokerRef(c.env.BROKER_INBOX_MAC_KEY, body.frame.region, body.frame.category);
	if (!ref) return c.text('not open', 403);
	const ns = c.env.BROKER;
	const broker = ns.get(ns.idFromName(brokerName(ref))) as unknown as BrokerStub;

	const handle = randomBytes(16);
	const inbox = await mintInboxToken(c.env.BROKER_INBOX_MAC_KEY, ref, handle, 0);
	if (!inbox) return c.text('not open', 403);

	const opened = await broker.openNeed({
		category: body.frame.category,
		commit: body.frame.commit,
		seekerInbox: inbox,
		handle
	});
	if (opened === 'full' || opened === 'bad-input') return c.text('not open', 503);
	return c.json({ inbox, need_ref: bytesToB64u(handleRefOf(ref, handle)) }, 202, {
		'cache-control': 'no-store'
	});
});

/** POST /api/aid/offer — a responder announces availability and claims at most one need. */
app.post('/api/aid/offer', async (c) => {
	const body = await brokerBody(c);
	if (body instanceof Response) return body;
	const refused = await aidGate(c, body.raw);
	if (refused) return refused;
	if (!(await verifyTurnstile(c.req.header('cf-turnstile-response'), c.env.TURNSTILE_SECRET)))
		return c.text('verification failed', 403);

	const ref = await brokerRef(c.env.BROKER_INBOX_MAC_KEY, body.frame.region, body.frame.category);
	if (!ref) return c.text('not open', 403);
	const ns = c.env.BROKER;
	const broker = ns.get(ns.idFromName(brokerName(ref))) as unknown as BrokerStub;

	const helperHandle = randomBytes(16);
	const helperInbox = await mintInboxToken(c.env.BROKER_INBOX_MAC_KEY, ref, helperHandle, 1);
	if (!helperInbox) return c.text('not open', 403);

	// AT MOST ONE. A responder who could see many open needs at once is a
	// responder who could enumerate the board, which is the thing a brokered
	// channel exists to prevent.
	const claimed = await broker.claimNeed(helperInbox, body.frame.category);
	return c.json(
		{
			inbox: helperInbox,
			need_ref: claimed ? bytesToB64u(handleRefOf(ref, hexToBytes(claimed.handleHex))) : null
		},
		202,
		{ 'cache-control': 'no-store' }
	);
});

/** POST /api/aid/accept — a responder's sealed card. HELD, never delivered here. */
app.post('/api/aid/accept', async (c) => {
	const body = await brokerBody(c);
	if (body instanceof Response) return body;
	const refused = await aidGate(c, body.raw);
	if (refused) return refused;

	// Verified BEFORE any Durable Object is addressed, so a forged token costs
	// zero instances.
	const token = await verifyInboxToken(
		c.env.BROKER_INBOX_MAC_KEY,
		c.req.header('X-HB-Inbox') ?? ''
	);
	if (!token) return c.text('not open', 403);

	const ns = c.env.BROKER;
	const broker = ns.get(ns.idFromName(brokerName(token.brokerRef))) as unknown as BrokerStub;
	const verdict = await broker.accept(
		bytesToHex(body.frame.handleRef.subarray(5)),
		c.req.header('X-HB-Inbox') ?? '',
		body.raw
	);
	// One flat 202 for every outcome. Telling a responder that a need was already
	// taken, or that their cap is spent, is a probe into board state.
	return c.json({ ok: verdict === 'ok' }, 202, { 'cache-control': 'no-store' });
});

/**
 * POST /api/aid/poll — collect whatever is waiting, in fixed time and fixed size.
 *
 * The body carries the inbox token and, for a seeker collecting an acceptance,
 * the preimage of their own commitment. That second request is what makes
 * exposure a deliberate, separately-ticked act rather than an automatic
 * consequence of having posted a need.
 *
 * The Broker keepalive rides in parallel. A Durable Object with no in-flight
 * request is evicted after 70 to 140 seconds of inactivity, and the poll goes to
 * the MAILBOX, so without this the Broker sees no traffic between an offer and
 * an accept and a match dies mid-handshake with its state gone.
 */
app.post('/api/aid/poll', async (c) => {
	const body = await brokerBody(c);
	if (body instanceof Response) return body;
	const refused = await aidGate(c, body.raw);
	if (refused) return refused;
	return brokerPoll(c, body.frame);
});

// --- Shared broker tails -----------------------------------------------------
// Everything AFTER the per-route gate. The gates themselves are never shared:
// gate-onion-only checks per handler block, and a guard reachable from one place
// can be deleted from one place while every route keeps looking guarded.

/** Announce an open need on the broker for this frame's (region, category). */
async function medicalOpen(
	c: { env: ApiEnv },
	frame: BrokerFrame,
	_raw: Uint8Array
): Promise<Response> {
	const ref = await brokerRef(c.env.BROKER_INBOX_MAC_KEY, frame.region, frame.category);
	if (!ref) return new Response('not open', { status: 403 });
	const ns = c.env.BROKER;
	const broker = ns.get(ns.idFromName(brokerName(ref))) as unknown as BrokerStub;
	const handle = randomBytes(16);
	const inbox = await mintInboxToken(c.env.BROKER_INBOX_MAC_KEY, ref, handle, 0);
	if (!inbox) return new Response('not open', { status: 403 });
	const opened = await broker.openNeed({
		category: frame.category,
		commit: frame.commit,
		seekerInbox: inbox,
		handle
	});
	if (opened === 'full' || opened === 'bad-input') return new Response('not open', { status: 503 });
	return Response.json(
		{ inbox, need_ref: bytesToB64u(handleRefOf(ref, handle)) },
		{ status: 202, headers: { 'cache-control': 'no-store' } }
	);
}

/** Claim at most one waiting need, and mint the responder's inbox. */
async function medicalClaim(c: { env: ApiEnv }, frame: BrokerFrame): Promise<Response> {
	const ref = await brokerRef(c.env.BROKER_INBOX_MAC_KEY, frame.region, frame.category);
	if (!ref) return new Response('not open', { status: 403 });
	const ns = c.env.BROKER;
	const broker = ns.get(ns.idFromName(brokerName(ref))) as unknown as BrokerStub;
	const handle = randomBytes(16);
	const inbox = await mintInboxToken(c.env.BROKER_INBOX_MAC_KEY, ref, handle, 1);
	if (!inbox) return new Response('not open', { status: 403 });
	const claimed = await broker.claimNeed(inbox, frame.category);
	return Response.json(
		{
			inbox,
			need_ref: claimed ? bytesToB64u(handleRefOf(ref, hexToBytes(claimed.handleHex))) : null
		},
		{ status: 202, headers: { 'cache-control': 'no-store' } }
	);
}

/** Record a responder's sealed card against a need. One flat outcome. */
async function medicalAccept(
	c: { env: ApiEnv; req: { header(name: string): string | undefined } },
	frame: BrokerFrame,
	raw: Uint8Array
): Promise<Response> {
	const inboxHeader = c.req.header('X-HB-Inbox') ?? '';
	const token = await verifyInboxToken(c.env.BROKER_INBOX_MAC_KEY, inboxHeader);
	if (!token) return new Response('not open', { status: 403 });
	const ns = c.env.BROKER;
	const broker = ns.get(ns.idFromName(brokerName(token.brokerRef))) as unknown as BrokerStub;
	const verdict = await broker.accept(bytesToHex(frame.handleRef.subarray(5)), inboxHeader, raw);
	return Response.json(
		{ ok: verdict === 'ok' },
		{ status: 202, headers: { 'cache-control': 'no-store' } }
	);
}

/**
 * Collect whatever is waiting, in fixed time and fixed size.
 *
 * The Broker keepalive rides in parallel. A Durable Object with no in-flight
 * request is evicted after 70 to 140 seconds, and the poll goes to the MAILBOX,
 * so without this the Broker sees no traffic between an offer and an accept and
 * a match dies mid-handshake with its state gone.
 */
async function brokerPoll(
	c: { env: ApiEnv; req: { header(name: string): string | undefined } },
	frame: BrokerFrame
): Promise<Response> {
	const inboxHeader = c.req.header('X-HB-Inbox') ?? '';
	const token = await verifyInboxToken(c.env.BROKER_INBOX_MAC_KEY, inboxHeader);
	if (!token) return new Response('not open', { status: 403 });

	const bns = c.env.BROKER;
	const broker = bns.get(bns.idFromName(brokerName(token.brokerRef))) as unknown as BrokerStub;
	const mns = c.env.MAILBOX;
	const mailbox = mns.get(mns.idFromName(inboxHeader)) as unknown as MailboxStub;

	// A non-zero commitment field means "release the card you are holding for me".
	const preimage = frame.commit;
	const wantsRelease = preimage.some((b) => b !== 0);
	const needHex = bytesToHex(frame.handleRef.subarray(5));

	const [, delivered] = await Promise.all([
		broker.keepalive(),
		(async () => {
			if (wantsRelease) {
				const released = await broker.reveal(needHex, preimage);
				if (released) await mailbox.deliver(released);
			}
			return mailbox.poll();
		})()
	]);

	return new Response(padPollResponse(delivered, randomBytes(BROKER_FRAME_LEN)), {
		status: 200,
		headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' }
	});
}

function bytesToHex(b: Uint8Array): string {
	let s = '';
	for (const x of b) s += x.toString(16).padStart(2, '0');
	return s;
}

function hexToBytes(s: string): Uint8Array {
	const out = new Uint8Array(s.length / 2);
	for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(s.slice(i * 2, i * 2 + 2), 16);
	return out;
}

function bytesToB64u(b: Uint8Array): string {
	let s = '';
	for (const x of b) s += String.fromCharCode(x);
	return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

// --- Brokered medical (PRD §4.7; ARCHITECTURE §5.3, §9.2) --------------------
//
// THE HANDLER ORDER BELOW IS THE INVERSE OF EVERY OTHER ROUTE IN THIS FILE, and
// the inversion is the point.
//
// Everywhere else the order is structural, then rate ladder, then flag, then
// credential. That order exists so a flood is discarded before it can spend a
// KV read or a signature verification, and so a malformed body earns a 400
// rather than a 401 that would leave the shape rule untestable.
//
// On a life-safety route the first question is different. A KV read, a Durable
// Object lookup and a D1 query are each an event on Cloudflare's side of the
// boundary, and their timing correlates with the request that caused them. For
// a route only an injured person or a medic would ever call, the fact that a
// request ARRIVED AT ALL is the sensitive fact. So origin is settled before any
// binding is touched: a clearnet caller gets a flat 403 and leaves no
// platform-side trace beyond the request line.
//
// Two things still run first, and neither reads a binding: the content-type
// check and the length cap. They must, because verifying the origin assertion
// means hashing the body, and buffering an unbounded body on an unauthenticated
// route is its own problem.
//
// ONE BODY READ, TWO CONSUMERS. The origin assertion and the proof of
// possession both bind the digest of the bytes that arrived, taken from a single
// read. Two reads that diverged would fail open on one of the two checks with
// nothing to notice.
//
// requireOnionOrigin IS WRITTEN OUT IN ALL FIVE HANDLERS ON PURPOSE. Factoring
// it into a shared helper would let it be deleted from one place while five
// routes kept looking guarded, and gate-onion-only checks per handler block for
// exactly that reason. Everything after it is shared.

/** Shared tail: the flag, then the one-shot credential. Never the origin check. */
async function medicalGate(
	c: { req: { raw: Request; header(name: string): string | undefined }; env: ApiEnv },
	raw: Uint8Array
): Promise<Response | null> {
	if (!(await broadOk(c))) return new Response('slow down', { status: 429 });
	// disabledUnderHeightenedThreat: FALSE, and this is a deliberate exception to
	// the house rule (maintainer decision, 2026-07-26). Every route here already
	// refuses over clearnet, which is a strictly stronger gate than heightened
	// threat and is unconditional today. Closing it again under heightened threat
	// would remove the only medical channel and leave nothing behind it, and this
	// platform offers no state emergency number to fall back to, by design.
	if (
		!(await featureAvailable(c.env.FLAGS, 'medical_broker', {
			disabledUnderHeightenedThreat: false
		}))
	)
		return new Response('not open', { status: 403 });
	const credential = await oneShotCredentialOk(c, raw, 'medical');
	if (!credential.ok) return new Response('credential required', { status: 401 });
	return null;
}

/** POST /api/medical/request — an injured person's sealed triage card. */
app.post('/api/medical/request', async (c) => {
	const ct = c.req.header('content-type') ?? '';
	if (!ct.includes('application/octet-stream')) return c.text('sealed envelope required', 415);
	if (Number(c.req.header('content-length') ?? '0') > maxEnvelopeLen(ALG_BROKER_ONESHOT))
		return c.text('too large', 413);
	const raw = new Uint8Array(await c.req.arrayBuffer());
	if (raw.length !== BROKER_FRAME_LEN) return c.text('sealed envelope required', 400);
	const bodyHash = new Uint8Array(await crypto.subtle.digest('SHA-256', raw as BufferSource));

	const refuse = await requireOnionOrigin(c.req.raw, bodyHash, c.env, Date.now());
	if (refuse) return refuse;

	const frame = parseBrokerFrame(raw);
	if (!frame) return c.text('sealed envelope required', 400);
	const gated = await medicalGate(c, raw);
	if (gated) return gated;
	return medicalOpen(c, frame, raw);
});

/** POST /api/medical/standby — a medic announces availability in a region. */
app.post('/api/medical/standby', async (c) => {
	const ct = c.req.header('content-type') ?? '';
	if (!ct.includes('application/octet-stream')) return c.text('sealed envelope required', 415);
	if (Number(c.req.header('content-length') ?? '0') > maxEnvelopeLen(ALG_BROKER_ONESHOT))
		return c.text('too large', 413);
	const raw = new Uint8Array(await c.req.arrayBuffer());
	if (raw.length !== BROKER_FRAME_LEN) return c.text('sealed envelope required', 400);
	const bodyHash = new Uint8Array(await crypto.subtle.digest('SHA-256', raw as BufferSource));

	const refuse = await requireOnionOrigin(c.req.raw, bodyHash, c.env, Date.now());
	if (refuse) return refuse;

	const frame = parseBrokerFrame(raw);
	if (!frame) return c.text('sealed envelope required', 400);
	const gated = await medicalGate(c, raw);
	if (gated) return gated;
	return medicalClaim(c, frame);
});

/** POST /api/medical/accept — a medic's sealed card, held pending the seeker. */
app.post('/api/medical/accept', async (c) => {
	const ct = c.req.header('content-type') ?? '';
	if (!ct.includes('application/octet-stream')) return c.text('sealed envelope required', 415);
	if (Number(c.req.header('content-length') ?? '0') > maxEnvelopeLen(ALG_BROKER_ONESHOT))
		return c.text('too large', 413);
	const raw = new Uint8Array(await c.req.arrayBuffer());
	if (raw.length !== BROKER_FRAME_LEN) return c.text('sealed envelope required', 400);
	const bodyHash = new Uint8Array(await crypto.subtle.digest('SHA-256', raw as BufferSource));

	const refuse = await requireOnionOrigin(c.req.raw, bodyHash, c.env, Date.now());
	if (refuse) return refuse;

	const frame = parseBrokerFrame(raw);
	if (!frame) return c.text('sealed envelope required', 400);
	const gated = await medicalGate(c, raw);
	if (gated) return gated;

	// No issuer is pinned, so medicTier is 'unvetted' for every badge and a HIGH
	// claim refuses here regardless of the flag. A BASIC responder still passes:
	// a first-aider who is present beats a doctor who is not.
	const claimed = c.req.header('X-HB-Medic-Tier');
	if (claimed === 'HIGH' && medicTier({ issuerId: '', claimedTier: 'HIGH' }) !== 'HIGH')
		return c.text('not open', 403);

	return medicalAccept(c, frame, raw);
});

/**
 * POST /api/medical/send — one sealed message on an established pairing.
 *
 * THE LATE MEET-POINT RIDES THIS ROUTE, and there is deliberately no separate
 * one for it. A dedicated reveal route would create a server-visible event
 * meaning "a precise location was shared at time T on lane L", which is exactly
 * the artifact the memory-only broker exists to not produce. Nor is any of this
 * wired to the LOCKED precise_location_reveal flag: that flag governs reveals
 * the PLATFORM performs, and here the platform relays ciphertext it cannot read.
 */
app.post('/api/medical/send', async (c) => {
	const ct = c.req.header('content-type') ?? '';
	if (!ct.includes('application/octet-stream')) return c.text('sealed envelope required', 415);
	if (Number(c.req.header('content-length') ?? '0') > maxEnvelopeLen(ALG_BROKER_ONESHOT))
		return c.text('too large', 413);
	const raw = new Uint8Array(await c.req.arrayBuffer());
	if (raw.length !== BROKER_FRAME_LEN) return c.text('sealed envelope required', 400);
	const bodyHash = new Uint8Array(await crypto.subtle.digest('SHA-256', raw as BufferSource));

	const refuse = await requireOnionOrigin(c.req.raw, bodyHash, c.env, Date.now());
	if (refuse) return refuse;

	const frame = parseBrokerFrame(raw);
	if (!frame) return c.text('sealed envelope required', 400);
	const gated = await medicalGate(c, raw);
	if (gated) return gated;

	const token = await verifyInboxToken(
		c.env.BROKER_INBOX_MAC_KEY,
		c.req.header('X-HB-Inbox') ?? ''
	);
	if (!token) return c.text('not open', 403);
	const mns = c.env.MAILBOX;
	const mailbox = mns.get(
		mns.idFromName(c.req.header('X-HB-Peer') ?? '')
	) as unknown as MailboxStub;
	await mailbox.deliver(raw);
	return c.json({ ok: true }, 202, { 'cache-control': 'no-store' });
});

/** POST /api/medical/poll — fixed time, fixed size, whether or not anything waits. */
app.post('/api/medical/poll', async (c) => {
	const ct = c.req.header('content-type') ?? '';
	if (!ct.includes('application/octet-stream')) return c.text('sealed envelope required', 415);
	if (Number(c.req.header('content-length') ?? '0') > maxEnvelopeLen(ALG_BROKER_ONESHOT))
		return c.text('too large', 413);
	const raw = new Uint8Array(await c.req.arrayBuffer());
	if (raw.length !== BROKER_FRAME_LEN) return c.text('sealed envelope required', 400);
	const bodyHash = new Uint8Array(await crypto.subtle.digest('SHA-256', raw as BufferSource));

	const refuse = await requireOnionOrigin(c.req.raw, bodyHash, c.env, Date.now());
	if (refuse) return refuse;

	const frame = parseBrokerFrame(raw);
	if (!frame) return c.text('sealed envelope required', 400);
	const gated = await medicalGate(c, raw);
	if (gated) return gated;
	return brokerPoll(c, frame);
});

// --- Helper offers and capacity bands (PRD §4.9) -----------------------------

/**
 * POST /api/help/offer — record one helper offer.
 *
 * ONE STATEMENT, AND DELIBERATELY NO SELECT. Deduplication is the UNIQUE index
 * plus ON CONFLICT DO NOTHING, not a read-then-write. That is not an
 * optimisation: it is what makes "no route reads this table row by row"
 * structurally true rather than a convention someone later breaks while
 * "improving" the error message. gate-no-enumeration refuses a SELECT against a
 * registry table inside any handler block.
 *
 * THE RESPONSE IS BYTE-IDENTICAL for a first offer and a duplicate. Returning
 * {created: true|false} would be an oracle telling the caller whether a given
 * pubkey had already offered in this bucket, which is a membership test against
 * a table whose whole point is that it cannot be queried for membership.
 */
app.post('/api/help/offer', async (c) => {
	const raw = new Uint8Array(await c.req.raw.clone().arrayBuffer());
	let body: {
		region_bucket?: unknown;
		skill?: unknown;
		tier?: unknown;
		languages?: unknown;
		accessibility?: unknown;
		dedup_token?: unknown;
	};
	try {
		body = JSON.parse(new TextDecoder().decode(raw));
	} catch {
		return c.json({ error: 'bad body' }, 400);
	}
	const region = body.region_bucket;
	const skill = body.skill;
	const tier = body.tier ?? 'BASIC';
	const dedup = body.dedup_token;
	if (typeof region !== 'string' || !/^[A-Z]{2}(-[A-Z0-9]{2,3}){1,2}$/.test(region))
		return c.json({ error: 'bad body' }, 400);
	// `accommodation` is not in the enum, so this is where a stranger-to-home
	// offer is refused. The CHECK constraint in 0019 says the same thing one
	// layer down, which is the layer that survives a Worker being replaced.
	if (typeof skill !== 'string' || !HELP_SKILLS.includes(skill))
		return c.json({ error: 'bad body' }, 400);
	if (typeof tier !== 'string' || !(TIERS as readonly string[]).includes(tier))
		return c.json({ error: 'bad body' }, 400);
	if (typeof dedup !== 'string' || !/^[0-9a-f]{64}$/.test(dedup))
		return c.json({ error: 'bad body' }, 400);

	if (!(await broadOk(c))) return c.text('slow down', 429);
	if (
		!(await featureAvailable(c.env.FLAGS, 'helper_registry', {
			disabledUnderHeightenedThreat: true
		}))
	)
		return c.text('not open', 403);

	const credential = await credentialOk(c, raw, 'directory');
	if (!credential.ok) {
		safeLog('credential_rejected', { route: c.req.routePath, outcome: credential.outcome });
		return c.text('credential required', 401);
	}
	if (!(await verifyTurnstile(c.req.header('cf-turnstile-response'), c.env.TURNSTILE_SECRET)))
		return c.text('verification failed', 403);

	// No issuer is pinned, so a HIGH claim cannot be honoured and is refused here
	// as well as by the empty issuer list. Same structural switch-on gate as the
	// medical accept route.
	if (tier === 'HIGH' && medicTier({ issuerId: '', claimedTier: 'HIGH' }) !== 'HIGH')
		return c.text('not open', 403);

	const epoch = offerEpochOf(Date.now());
	await c.env.DB.prepare(
		`INSERT INTO skills_registry
			(id, region_bucket, skill, tier, languages, accessibility, offer_epoch, dedup_token,
			 status, expires_epoch, created_bucket)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'LIVE', ?9, ?10)
		 ON CONFLICT(region_bucket, skill, offer_epoch, dedup_token) DO NOTHING`
	)
		.bind(
			crypto.randomUUID(),
			region,
			skill,
			tier,
			typeof body.languages === 'string' ? body.languages : null,
			typeof body.accessibility === 'string' ? body.accessibility : null,
			epoch,
			dedup,
			epoch + OFFER_LIFETIME_EPOCHS,
			new Date().toISOString().slice(0, 10)
		)
		.run();
	return c.json({ ok: true }, 202, { 'cache-control': 'no-store' });
});

/**
 * GET /api/help/capacity — the whole materialized grid, one statement, no
 * parameter.
 *
 * There is nothing to filter by, on purpose: a per-region query would be a
 * server-side record of which district somebody is interested in. The client
 * downloads the grid and reads its own cell.
 *
 * FLAG OFF RETURNS "NOT PUBLISHED", NOT NONE. NONE is a claim about the world;
 * absence is a claim about us. Conflating them would tell a seeker there is no
 * help when what is true is that we are not saying.
 */
app.get('/api/help/capacity', async (c) => {
	if (!(await flagEnabled(c.env.FLAGS, 'helper_registry')))
		return c.json({ published: false, bands: [] }, 200, {
			'cache-control': 'public, max-age=60'
		});
	try {
		const { results } = await c.env.DB.prepare('SELECT * FROM capacity_bands').all();
		return c.json({ published: true, bands: results }, 200, {
			'cache-control': 'public, max-age=300'
		});
	} catch {
		// Degrade-safe and DISTINGUISHABLE from both of the above. A reader must be
		// able to tell "we are not publishing" from "we could not read" from "there
		// is nobody here", and a test asserting only bands.length === 0 would pass
		// for all three.
		return c.json({ published: true, bands: [], stale: true }, 200, {
			'cache-control': 'public, max-age=30'
		});
	}
});

/** Closed vocabulary, mirroring the CHECK constraint in migration 0019. */
const HELP_SKILLS: readonly string[] = [
	'legal_aid',
	'medical_first_aid',
	'counselling',
	'translation',
	'journalism_intake',
	'accessibility_support',
	'transport_public',
	'supplies',
	'documentation'
];

/** Coarse rotation period for offers. Never a timestamp. */
const OFFER_EPOCH_MS = 24 * 60 * 60_000;
const OFFER_LIFETIME_EPOCHS = 7;

export function offerEpochOf(nowMs: number): number {
	return Math.floor(nowMs / OFFER_EPOCH_MS);
}

// --- The live board (ARCHITECTURE §6; PRD §4.5) -------------------------------

/** The slice of LiveBoard this Worker calls. */
interface LiveBoardStub {
	report(input: {
		zoneId: string;
		signal: SignalType;
		certHashHex: string;
		marshalValid?: boolean;
	}): Promise<'accepted'>;
	view(opts: { sinceTick?: number; waitMs?: number; heightened?: boolean }): Promise<BoardView>;
}

/**
 * GET /api/live/zones — the signed zone list, verbatim.
 *
 * The Worker does NOT verify this list and deliberately does not try. It is a
 * public, signed artefact and the reader is the verifier: apps/web re-checks the
 * publisher quorum against its own pinned directory before it will address any
 * board. A Worker-side check here would be defence-in-depth at best and, at
 * worst, the thing a client learns to trust instead — and a compelled Worker can
 * be compelled to skip an `if`. It cannot forge a signature, because no Ed25519
 * signing function exists anywhere in packages/crypto.
 *
 * Serving the list while live_board is off is intentional: the list is a map, not
 * a feed, and a client that holds it can tell "no zones near me" from "the
 * feature is off". Both are things it should be able to say.
 */
app.get('/api/live/zones', async (c) => {
	const headers = { 'cache-control': 'public, max-age=300' };
	try {
		const { results } = await c.env.DB.prepare(
			'SELECT zone_id, region_bucket, label_key, list_epoch, list_signature FROM live_zones WHERE active = 1'
		).all<{
			zone_id: string;
			region_bucket: string;
			label_key: string;
			list_epoch: number;
			list_signature: string;
		}>();

		// Zero rows is the resting state and it is NOT an error. The client renders
		// "no zones listed for your area", which is true.
		if (results.length === 0)
			return c.json({ list_epoch: 0, zones: [], signatures: [] }, 200, headers);

		// One list, one epoch. Rows disagreeing about the epoch means a half-applied
		// publish, and half a signed list is a list whose contents nobody signed.
		const epoch = results[0]?.list_epoch ?? 0;
		if (results.some((r) => r.list_epoch !== epoch))
			return c.json({ list_epoch: 0, zones: [], signatures: [] }, 200, headers);

		return c.json(
			{
				list_epoch: epoch,
				zones: results.map((r) => ({
					zone_id: r.zone_id,
					region_bucket: r.region_bucket,
					label_key: r.label_key
				})),
				signatures: JSON.parse(results[0]?.list_signature ?? '[]')
			},
			200,
			headers
		);
	} catch {
		// A read failure yields an EMPTY list, never a partial one. The client keeps
		// whatever list it already verified.
		return c.json({ list_epoch: 0, zones: [], signatures: [] }, 200, headers);
	}
});

/** Longest a reader may hold the connection open. Mirrors LiveBoard's own clamp. */
const LIVE_MAX_WAIT_MS = 25_000;

/**
 * GET /api/live/:zone — the public board for one zone.
 *
 * THERE IS NO CREDENTIAL AND NO RATE LIMIT ON THIS ROUTE, and both are decisions
 * rather than omissions.
 *
 * No credential, because §5 says never gate READING public safety info. A person
 * who has just walked into tear gas is not going to solve a Turnstile.
 *
 * No rate limit, and this is the sharper one. broadTiersOk keys a bucket on the
 * ASN. Every protestor on one carrier in one city shares an ASN, so an ASN bucket
 * on this route would saturate exactly when a crackdown sends everybody to the
 * app at once, and the hazard board would go dark for a whole network at the
 * moment it matters most. That is precisely the failure §6.5 forbids. What
 * bounds the cost instead: the zone list is closed and signed (zero rows today),
 * so the number of addressable Durable Objects is fixed by the list and not by
 * the request rate; the poll duration is clamped; and volumetric L7 is
 * Cloudflare's managed ruleset, per the standing division of labour.
 *
 * THE THREE READ SHAPES ARE DISTINGUISHABLE, following /api/help/capacity. A
 * reader must be able to tell "we are not publishing" from "we could not read"
 * from "there is nothing here", because a test asserting only signals.length === 0
 * passes for all three and so does a client that renders them the same way.
 */
app.get('/api/live/:zone', async (c) => {
	const zoneId = c.req.param('zone');
	if (!isZoneId(zoneId)) return c.json({ error: 'bad zone' }, 400);

	const headers = {
		// A cached board is a stale board served as fresh. The staleness contract
		// lives in the client, and it needs the tick to evaluate it.
		'cache-control': 'no-store'
	};

	if (!(await flagEnabled(c.env.FLAGS, 'live_board')))
		return c.json({ published: false, stale: false, board: null }, 200, headers);

	// Heightened threat TIGHTENS this route, it never closes it. Bands are the
	// part that goes away entirely (§6.4); TEAR_GAS is not.
	const [heightened, bandsOn] = await Promise.all([
		flagEnabled(c.env.FLAGS, 'heightened_threat'),
		featureAvailable(c.env.FLAGS, 'crowd_bands', { disabledUnderHeightenedThreat: true })
	]);

	try {
		const row = await c.env.DB.prepare(
			'SELECT zone_id FROM live_zones WHERE zone_id = ?1 AND active = 1'
		)
			.bind(zoneId)
			.first<{ zone_id: string }>();
		// The zone list is public and signed, so a 404 leaks nothing and tells a
		// client something it can act on: its copy of the list is out of date.
		if (row === null) return c.json({ error: 'unknown zone' }, 404, headers);
	} catch {
		// A READ failing closed would be the board going dark, so it fails to
		// stale instead and the client keeps its cached rows under a STALE badge.
		return c.json({ published: true, stale: true, board: null }, 200, headers);
	}

	const waitRaw = Number.parseInt(c.req.query('wait') ?? '0', 10);
	const sinceRaw = Number.parseInt(c.req.query('since') ?? '', 10);

	const ns = c.env.LIVE_BOARD;
	let view: BoardView;
	try {
		view = await (ns.get(ns.idFromName(`zone:${zoneId}`)) as unknown as LiveBoardStub).view({
			waitMs: Math.min(Number.isFinite(waitRaw) ? Math.max(waitRaw, 0) : 0, LIVE_MAX_WAIT_MS),
			...(Number.isFinite(sinceRaw) ? { sinceTick: sinceRaw } : {}),
			heightened
		});
	} catch {
		return c.json({ published: true, stale: true, board: null }, 200, headers);
	}

	// The Worker nulls the band, not the Durable Object. The DO knows about
	// heightened threat because that is a threshold question it has to answer
	// anyway, but it cannot read KV and so cannot know whether crowd_bands is on
	// at all. Two independent conditions, one of them enforced here.
	const board: BoardView = bandsOn ? view : { ...view, band: null };
	return c.json({ published: true, stale: false, board }, 200, {
		...headers,
		'x-hb-tick': String(view.tick)
	});
});

/**
 * POST /api/live/report — one hazard signal for one zone.
 *
 * THE SCHEMA CHECK RUNS FIRST, before the flag and before the credential, and it
 * rejects any coordinate-shaped key by NAME. Two reasons, and the second is the
 * one that bites: a route behind a credential returns 401 before reaching the
 * code under test, so with the credential first a test asserting "a body with a
 * latitude is refused" would pass with the schema rule deleted. The M4 lesson,
 * applied before the mistake.
 *
 * THE CREDENTIAL IS THE LONG-LIVED ONE, NEVER A ONE-SHOT, and the route rejects
 * a one-shot explicitly. The dedup token is derived from the certificate hash,
 * so a fresh certificate per heartbeat means a fresh apparent reporter every 45
 * seconds. At the heartbeat rate that inflates the count without bound and
 * defeats both the density floor and the corroboration bar. This is the one place
 * where M4's one-shot machinery is actively wrong.
 */
app.post('/api/live/report', async (c) => {
	const raw = new Uint8Array(await c.req.raw.clone().arrayBuffer());
	let body: unknown;
	try {
		body = JSON.parse(new TextDecoder().decode(raw));
	} catch {
		return c.json({ error: 'bad body' }, 400);
	}
	if (typeof body !== 'object' || body === null) return c.json({ error: 'bad body' }, 400);

	// Exact shape. An extra key is a field nobody decided was safe to accept, and
	// on this route the field somebody will add is a coordinate.
	const keys = Object.keys(body).sort();
	const allowed = ['marshal', 'signal', 'zone_id'];
	for (const k of keys) {
		if (!allowed.includes(k)) return c.json({ error: 'bad body' }, 400);
	}
	const {
		zone_id: zoneId,
		signal,
		marshal
	} = body as {
		zone_id?: unknown;
		signal?: unknown;
		marshal?: unknown;
	};
	if (typeof zoneId !== 'string' || !isZoneId(zoneId)) return c.json({ error: 'bad body' }, 400);
	if (typeof signal !== 'string' || !(SIGNAL_TYPES as readonly string[]).includes(signal))
		return c.json({ error: 'bad body' }, 400);

	if (!(await broadOk(c))) return c.text('slow down', 429);
	// Writes fail CLOSED. Reads are the ones that must never go dark.
	if (!(await flagEnabled(c.env.FLAGS, 'live_board'))) return c.text('not open', 403);

	const credential = await credentialOk(c, raw, 'document');
	if (!credential.ok) {
		safeLog('credential_rejected', { route: c.req.routePath, outcome: credential.outcome });
		return c.text('credential required', 401);
	}
	// A one-shot certificate on this route would inflate the reporter count by the
	// heartbeat rate. Refused explicitly rather than relied on being unusual.
	if (credential.oneShot) return c.text('credential required', 401);

	// The zone must be on the signed list AND active. live_zones ships with zero
	// rows, so this refuses every zone today.
	let active = false;
	try {
		const row = await c.env.DB.prepare(
			'SELECT zone_id FROM live_zones WHERE zone_id = ?1 AND active = 1'
		)
			.bind(zoneId)
			.first<{ zone_id: string }>();
		active = row !== null;
	} catch {
		// A read failure on a WRITE path fails closed.
		return c.text('not open', 403);
	}
	if (!active) return c.text('not open', 403);

	// SAFE_EXIT and DISPERSAL need a marshal quorum, verified BEFORE the Durable
	// Object is addressed: an unquorumed one must cost no instance and leave no
	// trace of having been attempted.
	let marshalValid = false;
	if (requiresQuorum(signal as SignalType)) {
		const bundle = marshal as { signatures?: RoleSignature[]; hashHex?: string } | undefined;
		if (!bundle?.signatures || typeof bundle.hashHex !== 'string') return c.text('not open', 403);
		const directory = await c.env.DB.prepare(
			"SELECT key_id, public_key, role, valid_from_epoch, valid_to_epoch FROM key_directory WHERE role = 'marshal'"
		).all<{
			key_id: string;
			public_key: string;
			role: string;
			valid_from_epoch: number;
			valid_to_epoch: number | null;
		}>();
		const revocations = await c.env.DB.prepare(
			'SELECT key_id, revoked_at_epoch FROM revocation_list'
		).all<{ key_id: string; revoked_at_epoch: number }>();
		const quorum = verifyRoleQuorum({
			contextTag: SIG_CONTEXT.marshalSignal,
			messageHash: hexToBytes(bundle.hashHex),
			signatures: bundle.signatures,
			directory: directory.results ?? [],
			revocations: revocations.results ?? [],
			requiredRole: 'marshal',
			required: MARSHAL_QUORUM_M,
			minDistinctKeys: MARSHAL_QUORUM_MIN_KEYS,
			epoch: 1
		});
		// WITHHELD, not shown low-confidence: a wrong SAFE_EXIT walks people into a
		// kettle, so an unquorumed one is refused at ingest rather than stored.
		if (!quorum.valid) return c.text('not open', 403);
		marshalValid = true;
	}

	const ns = c.env.LIVE_BOARD;
	const board = ns.get(ns.idFromName(`zone:${zoneId}`)) as unknown as LiveBoardStub;
	await board.report({
		zoneId,
		signal: signal as SignalType,
		certHashHex: credential.certHashHex ?? '',
		marshalValid
	});

	// One flat 202 for every outcome. The board's own view is the only channel a
	// reporter has to learn board state, and it is delayed and floored.
	return c.json({ ok: true }, 202, { 'cache-control': 'no-store' });
});

app.notFound((c) => c.text('not found', 404));

/** Cron: rebuild the public incident index from admitted rows only. */
export async function materialize(env: ApiEnv): Promise<void> {
	const builtBucket = new Date().toISOString().slice(0, 10);
	await env.DB.batch([
		env.DB.prepare('DELETE FROM incident_public_index'),
		env.DB.prepare(
			`INSERT INTO incident_public_index
         (id, type, occurred_date, region_bucket, coarse_geohash4, actor_role, actor_unit,
          injuries, detentions, narrative, verification_state, corroboration_count, built_bucket)
       SELECT id, type, occurred_date, region_bucket, coarse_geohash4, actor_role, actor_unit,
          injuries, detentions, narrative, verification_state, corroboration_count, ?
       FROM incidents
       WHERE status = 'PUBLIC' AND verification_state IN ('Human-Verified', 'Community-Corroborated')`
		).bind(builtBucket)
	]);
	await sweepProbation(env, builtBucket);
	await materializeCapacityBands(env, builtBucket);
	await sweepExpiredOffers(env, offerEpochOf(Date.now()));
}

/**
 * Rebuild the capacity grid (PRD §4.9).
 *
 * THE GRID IS FIXED AND FULLY WRITTEN EVERY CYCLE, empty cells included. A table
 * containing only the cells that have helpers is a map of where helpers are, so
 * the presence of a row must carry no information and only the band may move.
 *
 * The band arrives as a BOUND PARAMETER from bandFor(), never as SQL. The
 * thresholds decide how much an adversary learns from a published band, and they
 * belong somewhere a test can sweep them rather than inside an INSERT nobody can
 * reach. gate-no-enumeration enforces both halves.
 *
 * This is the only reader of skills_registry in the codebase, and it reads a
 * COUNT rather than rows.
 */
export async function materializeCapacityBands(env: ApiEnv, builtBucket: string): Promise<void> {
	if (!(await flagEnabled(env.FLAGS, 'helper_registry'))) return;
	const regions = await env.DB.prepare('SELECT DISTINCT region_bucket FROM capacity_bands').all<{
		region_bucket: string;
	}>();
	const known = new Set((regions.results ?? []).map((r) => r.region_bucket));
	const live = await env.DB.prepare(
		`SELECT region_bucket, skill, tier, COUNT(*) AS n FROM skills_registry
		 WHERE status = ?1 GROUP BY region_bucket, skill, tier`
	)
		.bind('LIVE')
		.all<{ region_bucket: string; skill: string; tier: string; n: number }>();

	const counts = new Map<string, number>();
	for (const row of live.results ?? []) {
		counts.set(`${row.region_bucket}|${row.skill}|${row.tier}`, row.n);
		known.add(row.region_bucket);
	}

	const statements = [];
	for (const region of known) {
		for (const skill of HELP_SKILLS) {
			for (const tier of TIERS) {
				const n = counts.get(`${region}|${skill}|${tier}`) ?? 0;
				const band: Band = bandFor(n, tier as Tier);
				statements.push(
					env.DB.prepare(
						`INSERT INTO capacity_bands (region_bucket, skill, tier, band, built_bucket, pack_epoch)
						 VALUES (?1, ?2, ?3, ?4, ?5, 0)
						 ON CONFLICT(region_bucket, skill, tier)
						 DO UPDATE SET band = ?4, built_bucket = ?5`
					).bind(region, skill, tier, band, builtBucket)
				);
			}
		}
	}
	if (statements.length > 0) await env.DB.batch(statements);
	safeLog('capacity_materialize', { count: statements.length, outcome: 'built' });
}

/**
 * Drop offers past their lifetime.
 *
 * DELETES rather than hides. Hide-not-delete is an evidence and moderation rule,
 * where losing something good is the harm; an expired offer is retention hygiene
 * and keeping it only grows the set a compelled restore would yield.
 *
 * HONEST LIMIT: this is NOT a compulsion defence. D1 Time Travel is roughly 30
 * days, so a compelled restore reaches deleted rows. What survives compulsion
 * here is that the row never held anything from which a person could be reached
 * in the first place.
 */
export async function sweepExpiredOffers(env: ApiEnv, nowEpoch: number): Promise<void> {
	const res = await env.DB.prepare('DELETE FROM skills_registry WHERE expires_epoch <= ?1')
		.bind(nowEpoch)
		.run();
	safeLog('offer_sweep', { count: res.meta?.changes ?? 0, outcome: 'swept' });
}

/**
 * Advance the probation window for items whose re-scan is due (ARCHITECTURE §16).
 *
 * Rides the existing hourly cron rather than adding a trigger. Reads only the
 * two leading index columns so rows-read stays rows-scanned, and the decision
 * itself lives in @harborage/worker-lib/archive so it is unit-tested rather
 * than being an inline condition here.
 *
 * NOTHING IS DELETED. The window clearing means "re-scanned clean for the full
 * period"; an item that matched a known-bad list moves to HELD and stays there
 * until a human decides, and an item with an open objection does not clear at
 * all. There is no state this can reach that puts an item beyond removal.
 */
export async function sweepProbation(env: ApiEnv, todayBucket: string): Promise<void> {
	const due = await env.DB.prepare(
		`SELECT original_sha256, created_bucket, rescan_count FROM archive_items
		 WHERE probation_state = ?1 LIMIT 200`
	)
		.bind('OPEN')
		.all<{ original_sha256: string; created_bucket: string; rescan_count: number }>();

	for (const item of due.results ?? []) {
		const openDisputes = await env.DB.prepare(
			'SELECT COUNT(*) AS n FROM archive_disputes WHERE original_sha256 = ?1 AND outcome = ?2'
		)
			.bind(item.original_sha256, 'open')
			.first<{ n: number }>();

		const decision = advanceProbation({
			state: 'OPEN',
			createdBucket: item.created_bucket,
			todayBucket,
			// Re-scanning against rolling known-bad lists is a human/tooling step
			// that does not exist yet. Reporting "no hit" here would be a claim we
			// cannot support, so the sweep only advances the clock and an actual
			// hit arrives through the review path.
			rescanHit: false,
			openDisputes: openDisputes?.n ?? 0
		});

		await env.DB.prepare(
			'UPDATE archive_items SET probation_state = ?1, probation_due_bucket = ?2, rescan_count = ?3 WHERE original_sha256 = ?4'
		)
			.bind(decision.state, decision.nextDueBucket, item.rescan_count + 1, item.original_sha256)
			.run();
	}
	safeLog('probation_sweep', { count: (due.results ?? []).length, outcome: 'swept' });
}
