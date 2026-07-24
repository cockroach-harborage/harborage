/**
 * workers/media routes (ARCHITECTURE §3.1, §7.6). Presigns direct-to-R2 uploads
 * so bytes never proxy the Worker. All endpoints are behind record_intake
 * (fail-closed OFF) and require presign credentials (set only at switch-on), so
 * this is dormant at M1. Kept separate from index.ts to stay Node-testable.
 */
import { Hono } from 'hono';
import { featureAvailable } from '@harborage/worker-lib/flags';
import { safeLog, statusClass } from '@harborage/worker-lib/safe-log';
import type { MediaEnv } from '@harborage/worker-lib/types';
import { EVIDENCE_VAULT_BUCKET, PUBLIC_MEDIA_BUCKET, R2S3, type CompletedPart } from './s3.ts';

type Ctx = { Bindings: MediaEnv };

export const app = new Hono<Ctx>();

app.use('*', async (c, next) => {
	const started = Date.now();
	await next();
	c.header('X-Content-Type-Options', 'nosniff');
	c.header('Referrer-Policy', 'no-referrer');
	c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
	safeLog('media_request', {
		route: c.req.routePath,
		statusClass: statusClass(c.res.status),
		ms: Date.now() - started
	});
});

/** Both gates: the feature flag (fail-closed OFF) and presence of presign creds. */
async function ready(c: { env: MediaEnv }): Promise<boolean> {
	if (!(await featureAvailable(c.env.FLAGS, 'record_intake', { disabledUnderHeightenedThreat: true })))
		return false;
	return Boolean(
		c.env.R2_ACCOUNT_ID && c.env.R2_PRESIGN_ACCESS_KEY_ID && c.env.R2_PRESIGN_SECRET_ACCESS_KEY
	);
}

function s3(env: MediaEnv): R2S3 {
	return new R2S3(env.R2_ACCOUNT_ID, env.R2_PRESIGN_ACCESS_KEY_ID, env.R2_PRESIGN_SECRET_ACCESS_KEY);
}

/** Public derivative key: content-addressed for exact-byte dedup (public copy). */
function derivativeKey(sha256: string): string {
	return `sha256/${sha256.slice(0, 2)}/${sha256}`;
}

// --- Vault original: resumable multipart, presigned per part -----------------
app.post('/media/create', async (c) => {
	if (!(await ready(c))) return c.text('not open', 403);
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
	if (!(await ready(c))) return c.text('not open', 403);
	const b = (await c.req.json().catch(() => null)) as {
		key?: unknown;
		uploadId?: unknown;
		partNumber?: unknown;
	} | null;
	if (!b || typeof b.key !== 'string' || typeof b.uploadId !== 'string' || typeof b.partNumber !== 'number')
		return c.text('bad request', 400);
	const url = await s3(c.env).presignPart(EVIDENCE_VAULT_BUCKET, b.key, b.uploadId, b.partNumber);
	return c.json({ url }, 200, { 'cache-control': 'no-store' });
});

app.post('/media/complete', async (c) => {
	if (!(await ready(c))) return c.text('not open', 403);
	const b = (await c.req.json().catch(() => null)) as {
		key?: unknown;
		uploadId?: unknown;
		parts?: unknown;
	} | null;
	if (!b || typeof b.key !== 'string' || typeof b.uploadId !== 'string' || !Array.isArray(b.parts))
		return c.text('bad request', 400);
	try {
		await s3(c.env).completeMultipart(EVIDENCE_VAULT_BUCKET, b.key, b.uploadId, b.parts as CompletedPart[]);
		return c.json({ ok: true }, 200, { 'cache-control': 'no-store' });
	} catch {
		return c.text('complete failed', 502);
	}
});

app.post('/media/abort', async (c) => {
	if (!(await ready(c))) return c.text('not open', 403);
	const b = (await c.req.json().catch(() => null)) as { key?: unknown; uploadId?: unknown } | null;
	if (!b || typeof b.key !== 'string' || typeof b.uploadId !== 'string')
		return c.text('bad request', 400);
	await s3(c.env).abortMultipart(EVIDENCE_VAULT_BUCKET, b.key, b.uploadId);
	return c.json({ ok: true }, 200, { 'cache-control': 'no-store' });
});

app.post('/media/head', async (c) => {
	if (!(await ready(c))) return c.text('not open', 403);
	const b = (await c.req.json().catch(() => null)) as { key?: unknown } | null;
	if (!b || typeof b.key !== 'string') return c.text('bad request', 400);
	const exists = await s3(c.env).headObject(EVIDENCE_VAULT_BUCKET, b.key);
	return c.json({ exists }, 200, { 'cache-control': 'no-store' });
});

// --- Public redacted derivative: single presigned PUT, content-addressed ------
app.post('/media/derivative', async (c) => {
	if (!(await ready(c))) return c.text('not open', 403);
	const b = (await c.req.json().catch(() => null)) as { sha256?: unknown } | null;
	if (!b || typeof b.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(b.sha256))
		return c.text('bad request', 400);
	const key = derivativeKey(b.sha256);
	const url = await s3(c.env).presignPut(PUBLIC_MEDIA_BUCKET, key);
	return c.json({ url, key }, 200, { 'cache-control': 'no-store' });
});

app.notFound((c) => c.text('not found', 404));
