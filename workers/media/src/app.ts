/**
 * workers/media routes (ARCHITECTURE §3.1, §7.6). Presigns direct-to-R2 uploads
 * so bytes never proxy the Worker. All endpoints are behind document_intake
 * (fail-closed OFF) and require presign credentials (set only at switch-on), so
 * this is dormant at M1. Kept separate from index.ts to stay Node-testable.
 *
 * Abuse defense: the mutating endpoints are rate-limited via the api Worker's
 * memory-only RateLimit DO (shared cross-script). Turnstile is NOT re-checked
 * here: its token is single-use and is spent at `/api/incidents/register`, which
 * gates the whole flow; the real per-request personhood + auth gate is the
 * cap-cert + proof-of-possession landing in M2. Until then, rate-limiting plus
 * the fail-closed flag is the deliberate app-layer control.
 */
import { Hono } from 'hono';
import {
	nonceRetentionMs,
	verifyRequestCredential,
	type CredentialResult
} from '@harborage/worker-lib/cap-cert';
import { featureAvailable } from '@harborage/worker-lib/flags';
import { admitCredential, bucketKey, broadTiersOk } from '@harborage/worker-lib/ratelimit';
import { coarseMs, safeLog, statusClass } from '@harborage/worker-lib/safe-log';
import type { MediaEnv } from '@harborage/worker-lib/types';
import { EVIDENCE_VAULT_BUCKET, PUBLIC_MEDIA_BUCKET, R2S3, validateParts } from './s3.ts';

type Ctx = { Bindings: MediaEnv };

export const app = new Hono<Ctx>();

app.use('*', async (c, next) => {
	const started = Date.now();
	await next();
	c.header('X-Content-Type-Options', 'nosniff');
	c.header('Referrer-Policy', 'no-referrer');
	c.header(
		'Content-Security-Policy',
		"default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
	);
	safeLog('media_request', {
		route: c.req.routePath,
		statusClass: statusClass(c.res.status),
		ms: coarseMs(Date.now() - started)
	});
});

/** Broad rungs of the shared ladder (§17.6): a global shard and the origin ASN. */
async function rateOk(c: {
	req: { header(name: string): string | undefined; raw: Request };
	env: MediaEnv;
}): Promise<boolean> {
	const keyHashHex = await bucketKey(c.req.header('CF-Connecting-IP') ?? 'unknown');
	const asn = (c.req.raw as { cf?: { asn?: number } }).cf?.asn;
	return broadTiersOk(c.env, { keyHashHex, asn });
}

/**
 * Per-request credential on EVERY presign route (§17.6).
 *
 * This closes a real gap rather than following the spec sketch. §7.6 has
 * register hand back a "media upload ticket" that these routes would check; a
 * ticket needs a new shared secret between two Workers and new state to track,
 * and until it existed `/media/create` would mint vault multipart uploads
 * behind nothing but an IP and ASN bucket. The cap-cert plus proof of
 * possession the codebase already has does the ticket's job with neither: it
 * binds the request to one key, one compartment and this exact body, once, and
 * gives the per-credential rung of the ladder something to charge.
 *
 * Turnstile is still not re-checked here: its token is single-use and is spent
 * at /api/incidents/register, which gates the whole flow.
 *
 * A flat 401 with no detail, for the same reason as the api Worker: naming the
 * failing check hands an attacker an oracle for clock skew and nonce state.
 */
async function credentialOk(
	c: { req: { raw: Request }; env: MediaEnv },
	body: Uint8Array
): Promise<{ ok: boolean; outcome: string }> {
	const result: CredentialResult = await verifyRequestCredential(c.req.raw, body, {
		nowMs: Date.now(),
		compartment: 'document'
	});
	if (!result.ok) return { ok: false, outcome: result.reason };
	const verdict = await admitCredential(c.env, {
		certHashHex: result.certHashHex,
		nonceHex: result.nonceHex,
		retainMs: nonceRetentionMs({})
	});
	return { ok: verdict === 'ok', outcome: verdict };
}

/**
 * Read the raw bytes ONCE and hand them to both the proof of possession and the
 * JSON parse. The PoP binds to exactly what arrived, so re-serialising a parsed
 * object would break the signature.
 */
async function readBody(c: { req: { raw: Request } }): Promise<{ raw: Uint8Array; json: unknown }> {
	const raw = new Uint8Array(await c.req.raw.clone().arrayBuffer());
	let json: unknown = null;
	try {
		json = JSON.parse(new TextDecoder().decode(raw));
	} catch {
		json = null;
	}
	return { raw, json };
}

/** Both gates: the feature flag (fail-closed OFF) and presence of presign creds. */
async function ready(c: { env: MediaEnv }): Promise<boolean> {
	if (
		!(await featureAvailable(c.env.FLAGS, 'document_intake', { disabledUnderHeightenedThreat: true }))
	)
		return false;
	return Boolean(
		c.env.R2_ACCOUNT_ID && c.env.R2_PRESIGN_ACCESS_KEY_ID && c.env.R2_PRESIGN_SECRET_ACCESS_KEY
	);
}

function s3(env: MediaEnv): R2S3 {
	return new R2S3(
		env.R2_ACCOUNT_ID!,
		env.R2_PRESIGN_ACCESS_KEY_ID!,
		env.R2_PRESIGN_SECRET_ACCESS_KEY!
	);
}

/** Public derivative key: content-addressed for exact-byte dedup (public copy). */
function derivativeKey(sha256: string): string {
	return `sha256/${sha256.slice(0, 2)}/${sha256}`;
}

// --- Vault original: resumable multipart, presigned per part -----------------
app.post('/media/create', async (c) => {
	if (!(await rateOk(c))) return c.text('slow down', 429);
	if (!(await ready(c))) return c.text('not open', 403);
	const { raw, json } = await readBody(c);
	const credential = await credentialOk(c, raw);
	if (!credential.ok) {
		safeLog('credential_rejected', { route: c.req.routePath, outcome: credential.outcome });
		return c.text('credential required', 401);
	}
	// Opaque key — never content-derived (no existence oracle on the vault).
	const key = crypto.randomUUID();
	try {
		const uploadId = await s3(c.env).createMultipart(EVIDENCE_VAULT_BUCKET, key);
		return c.json({ key, uploadId }, 200, { 'cache-control': 'no-store' });
	} catch {
		return c.text('create failed', 502);
	}
});

app.post('/media/part', async (c) => {
	if (!(await rateOk(c))) return c.text('slow down', 429);
	if (!(await ready(c))) return c.text('not open', 403);
	const { raw, json } = await readBody(c);
	const credential = await credentialOk(c, raw);
	if (!credential.ok) {
		safeLog('credential_rejected', { route: c.req.routePath, outcome: credential.outcome });
		return c.text('credential required', 401);
	}
	const b = json as { key?: unknown; uploadId?: unknown; partNumber?: unknown } | null;
	if (
		!b ||
		typeof b.key !== 'string' ||
		typeof b.uploadId !== 'string' ||
		typeof b.partNumber !== 'number' ||
		!Number.isInteger(b.partNumber) ||
		b.partNumber < 1 ||
		b.partNumber > 10_000
	)
		// R2 allows 1..10000. Bounding it HERE, not only at complete time, means we
		// never sign a URL for a part number R2 will refuse.
		return c.text('bad request', 400);
	const url = await s3(c.env).presignPart(EVIDENCE_VAULT_BUCKET, b.key, b.uploadId, b.partNumber);
	return c.json({ url }, 200, { 'cache-control': 'no-store' });
});

app.post('/media/complete', async (c) => {
	if (!(await rateOk(c))) return c.text('slow down', 429);
	if (!(await ready(c))) return c.text('not open', 403);
	const { raw, json } = await readBody(c);
	const credential = await credentialOk(c, raw);
	if (!credential.ok) {
		safeLog('credential_rejected', { route: c.req.routePath, outcome: credential.outcome });
		return c.text('credential required', 401);
	}
	const b = json as { key?: unknown; uploadId?: unknown; parts?: unknown } | null;
	if (!b || typeof b.key !== 'string' || typeof b.uploadId !== 'string')
		return c.text('bad request', 400);
	let parts;
	try {
		parts = validateParts(b.parts); // reject malformed client parts before signing a body
	} catch {
		return c.text('bad request', 400);
	}
	try {
		await s3(c.env).completeMultipart(EVIDENCE_VAULT_BUCKET, b.key, b.uploadId, parts);
		return c.json({ ok: true }, 200, { 'cache-control': 'no-store' });
	} catch {
		return c.text('complete failed', 502);
	}
});

app.post('/media/abort', async (c) => {
	if (!(await rateOk(c))) return c.text('slow down', 429);
	if (!(await ready(c))) return c.text('not open', 403);
	const { raw, json } = await readBody(c);
	const credential = await credentialOk(c, raw);
	if (!credential.ok) {
		safeLog('credential_rejected', { route: c.req.routePath, outcome: credential.outcome });
		return c.text('credential required', 401);
	}
	const b = json as { key?: unknown; uploadId?: unknown } | null;
	if (!b || typeof b.key !== 'string' || typeof b.uploadId !== 'string')
		return c.text('bad request', 400);
	await s3(c.env).abortMultipart(EVIDENCE_VAULT_BUCKET, b.key, b.uploadId);
	return c.json({ ok: true }, 200, { 'cache-control': 'no-store' });
});

app.post('/media/head', async (c) => {
	if (!(await rateOk(c))) return c.text('slow down', 429);
	if (!(await ready(c))) return c.text('not open', 403);
	const { raw, json } = await readBody(c);
	const credential = await credentialOk(c, raw);
	if (!credential.ok) {
		safeLog('credential_rejected', { route: c.req.routePath, outcome: credential.outcome });
		return c.text('credential required', 401);
	}
	const b = json as { key?: unknown } | null;
	if (!b || typeof b.key !== 'string') return c.text('bad request', 400);
	const exists = await s3(c.env).headObject(EVIDENCE_VAULT_BUCKET, b.key);
	return c.json({ exists }, 200, { 'cache-control': 'no-store' });
});

// --- Public redacted derivative: single presigned PUT, content-addressed ------
app.post('/media/derivative', async (c) => {
	if (!(await rateOk(c))) return c.text('slow down', 429);
	if (!(await ready(c))) return c.text('not open', 403);
	const { raw, json } = await readBody(c);
	const credential = await credentialOk(c, raw);
	if (!credential.ok) {
		safeLog('credential_rejected', { route: c.req.routePath, outcome: credential.outcome });
		return c.text('credential required', 401);
	}
	const b = json as { sha256?: unknown } | null;
	if (!b || typeof b.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(b.sha256))
		return c.text('bad request', 400);
	const key = derivativeKey(b.sha256);
	const url = await s3(c.env).presignPut(PUBLIC_MEDIA_BUCKET, key);
	return c.json({ url, key }, 200, { 'cache-control': 'no-store' });
});

app.notFound((c) => c.text('not found', 404));
