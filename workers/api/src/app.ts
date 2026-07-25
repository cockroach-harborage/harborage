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
import type { ApiEnv } from '@harborage/worker-lib/types';

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
}
