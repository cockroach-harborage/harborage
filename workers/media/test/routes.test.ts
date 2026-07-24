import { describe, expect, it } from 'vitest';
import { app } from '../src/app.ts';

// Media routes are dormant at M1 (record_intake OFF, presign creds unset). These
// prove the fail-closed gate and that untrusted input is rejected before any R2
// call, without needing live R2 or a real flag store.

/** An env where record_intake reads OFF (KV absent ⇒ flagEnabled fails closed). */
const closedEnv = {} as never;

/** A stub env with the flag ON, presign creds present, and a rate-limit verdict. */
function openEnv(rateAllows: boolean) {
	const flagRecord = JSON.stringify({ enabled: true, epoch: 1, updatedAt: '2026-07-25' });
	return {
		// record_intake ON, heightened_threat (and all else) OFF.
		FLAGS: { get: async (k: string) => (k === 'flag:record_intake' ? flagRecord : null) },
		R2_ACCOUNT_ID: 'acct',
		R2_PRESIGN_ACCESS_KEY_ID: 'AKIAEXAMPLE',
		R2_PRESIGN_SECRET_ACCESS_KEY: 'secretexample',
		RATE_LIMIT: {
			idFromName: (n: string) => n,
			get: () => ({ allow: async () => rateAllows })
		}
	} as never;
}

const mutating = [
	'/media/create',
	'/media/part',
	'/media/complete',
	'/media/abort',
	'/media/head',
	'/media/derivative'
];

describe('media routes fail closed while record_intake is OFF', () => {
	it.each(mutating)('%s returns 403 with no flag/creds', async (path) => {
		const res = await app.request(path, { method: 'POST', body: '{}' }, closedEnv);
		expect(res.status).toBe(403);
	});
});

describe('media routes when open', () => {
	it('rate-limits /media/create with 429 when the bucket is empty', async () => {
		const res = await app.request('/media/create', { method: 'POST', body: '{}' }, openEnv(false));
		expect(res.status).toBe(429);
	});

	it('/media/complete rejects malformed parts with 400 before signing a body', async () => {
		const res = await app.request(
			'/media/complete',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ key: 'k', uploadId: 'u', parts: [{ n: 1, etag: '"</ETag><x/>"' }] })
			},
			openEnv(true)
		);
		expect(res.status).toBe(400);
	});

	it('/media/derivative rejects a non-sha256 key with 400', async () => {
		const res = await app.request(
			'/media/derivative',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ sha256: 'not-a-hash' })
			},
			openEnv(true)
		);
		expect(res.status).toBe(400);
	});
});
