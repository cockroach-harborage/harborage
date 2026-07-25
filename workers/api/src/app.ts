/**
 * workers/api routes + materializer (ARCHITECTURE §3.1, §7.6, §12). Kept
 * separate from the worker entry (index.ts) so it imports no Workers-only module
 * (`cloudflare:workers`) and can be unit-tested in plain Node. Enqueue-and-
 * return-fast; sensitive bodies must be sealed envelopes; public reads are open,
 * edge-cached, and searched client-side (no query logging).
 */
import { Hono } from 'hono';
import {
	ALG_VAULT_KEYRING,
	isSealedEnvelope,
	unframeEnvelope,
	MAX_ENVELOPE_LEN
} from '@harborage/worker-lib/envelope';
import { featureAvailable, flagEnabled } from '@harborage/worker-lib/flags';
import { coarseMs, safeLog, statusClass } from '@harborage/worker-lib/safe-log';
import { verifyTurnstile } from '@harborage/worker-lib/turnstile';
import {
	nonceRetentionMs,
	verifyRequestCredential,
	type CredentialResult
} from '@harborage/worker-lib/cap-cert';
import { admitCredential, bucketKey, broadTiersOk } from '@harborage/worker-lib/ratelimit';
import type { Compartment } from '@harborage/crypto/compartments';
import { advanceProbation, dedupVerdict } from '@harborage/worker-lib/archive';
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
async function broadOk(c: { req: { header(name: string): string | undefined; raw: Request }; env: ApiEnv }) {
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
): Promise<{ ok: boolean; outcome: string }> {
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
	return { ok: verdict === 'ok', outcome: verdict };
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
		!(await featureAvailable(c.env.FLAGS, 'document_intake', { disabledUnderHeightenedThreat: true }))
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
		!(await featureAvailable(c.env.FLAGS, 'evidence_vault', { disabledUnderHeightenedThreat: true }))
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
	if (keys.length !== 1 || keys[0] !== 'derivative_sha256') return c.json({ error: 'bad body' }, 400);
	const sha = (body as { derivative_sha256: unknown }).derivative_sha256;
	if (typeof sha !== 'string' || !/^[0-9a-f]{64}$/.test(sha))
		return c.json({ error: 'bad body' }, 400);

	if (!(await broadOk(c))) return c.text('slow down', 429);
	if (
		!(await featureAvailable(c.env.FLAGS, 'archive_publish', { disabledUnderHeightenedThreat: true }))
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
		!(await featureAvailable(c.env.FLAGS, 'archive_publish', { disabledUnderHeightenedThreat: true }))
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
		return c.json(
			{ anchor, custody: lines },
			200,
			{ 'cache-control': 'public, max-age=300' }
		);
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
	if (!(await featureAvailable(c.env.FLAGS, 'archive_publish', { disabledUnderHeightenedThreat: true })))
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
			.bind(
				decision.state,
				decision.nextDueBucket,
				item.rescan_count + 1,
				item.original_sha256
			)
			.run();
	}
	safeLog('probation_sweep', { count: (due.results ?? []).length, outcome: 'swept' });
}
