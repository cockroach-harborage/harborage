/**
 * workers/api routes + materializer (ARCHITECTURE §3.1, §7.6, §12). Kept
 * separate from the worker entry (index.ts) so it imports no Workers-only module
 * (`cloudflare:workers`) and can be unit-tested in plain Node. Enqueue-and-
 * return-fast; sensitive bodies must be sealed envelopes; public reads are open,
 * edge-cached, and searched client-side (no query logging).
 */
import { Hono } from 'hono';
import { isSealedEnvelope, MAX_ENVELOPE_LEN } from '@harborage/worker-lib/envelope';
import { featureAvailable, flagEnabled } from '@harborage/worker-lib/flags';
import { safeLog, statusClass } from '@harborage/worker-lib/safe-log';
import type { ApiEnv } from '@harborage/worker-lib/types';
import { verifyTurnstile } from './turnstile.ts';

interface RateLimitStub {
	allow(cost?: number): Promise<boolean>;
}

type Ctx = { Bindings: ApiEnv };

export const app = new Hono<Ctx>();

// Security-header baseline + request logging (matched route + status class + ms).
app.use('*', async (c, next) => {
	const started = Date.now();
	await next();
	c.header('X-Content-Type-Options', 'nosniff');
	c.header('Referrer-Policy', 'no-referrer');
	c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
	safeLog('api_request', {
		route: c.req.routePath,
		statusClass: statusClass(c.res.status),
		ms: Date.now() - started
	});
});

async function bucketKey(ip: string): Promise<string> {
	const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
	return Array.from(new Uint8Array(d).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** App-layer rate limit keyed by a hash of the connecting IP (never logged/persisted). */
async function rateOk(c: {
	req: { header(name: string): string | undefined };
	env: ApiEnv;
}): Promise<boolean> {
	const key = await bucketKey(c.req.header('CF-Connecting-IP') ?? 'unknown');
	const stub = c.env.RATE_LIMIT.get(c.env.RATE_LIMIT.idFromName(key)) as unknown as RateLimitStub;
	return stub.allow(1);
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

	// 2. Rate limit, then the fail-closed feature flag, then Turnstile.
	if (!(await rateOk(c))) return c.text('slow down', 429);
	if (!(await featureAvailable(c.env.FLAGS, 'record_intake', { disabledUnderHeightenedThreat: true })))
		return c.text('not open', 403);
	if (!(await verifyTurnstile(c.req.header('cf-turnstile-response'), c.env.TURNSTILE_SECRET)))
		return c.text('verification failed', 403);

	// 3. Enqueue only — no D1 write on the hot path. The M2 consumer records the
	//    incident. (Full cap-cert + PoP verification also lands with identity, M2.)
	await c.env.MODERATION_BULK.send({ kind: 'incident_register', envelope: buf });
	return c.json({ receipt: crypto.randomUUID() }, 202, { 'cache-control': 'no-store' });
});

// --- Report-a-problem (route-to-gate) ---------------------------------------
// POST /api/directory/report — NOT sealed: a report is public, non-personal
// {entity_id, reason_code}. Never auto-hides; only queues for human review.
app.post('/api/directory/report', async (c) => {
	const body = (await c.req.json().catch(() => null)) as {
		entity_id?: unknown;
		reason_code?: unknown;
	} | null;
	if (!body || typeof body.entity_id !== 'string' || typeof body.reason_code !== 'string')
		return c.text('bad request', 400);
	if (!(await rateOk(c))) return c.text('slow down', 429);
	if (!(await featureAvailable(c.env.FLAGS, 'directory_intake', { disabledUnderHeightenedThreat: true })))
		return c.text('not open', 403);
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
		return c.json({ published: false, incidents: [] }, 200, { 'cache-control': 'public, max-age=60' });
	const { results } = await c.env.DB.prepare('SELECT * FROM incident_public_index').all();
	return c.json({ published: true, incidents: results }, 200, { 'cache-control': 'public, max-age=300' });
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
		featureAvailable(c.env.FLAGS, 'record_intake', { disabledUnderHeightenedThreat: true }),
		featureAvailable(c.env.FLAGS, 'directory_intake', { disabledUnderHeightenedThreat: true })
	]);
	return c.json(
		{ record_intake: recordIntake, directory_intake: directoryIntake },
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
       WHERE status = 'PUBLIC' AND verification_state IN ('Verified', 'Community-Corroborated')`
		).bind(builtBucket)
	]);
}
