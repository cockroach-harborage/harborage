import { describe, expect, it } from 'vitest';
import {
	capCertBody,
	frameCapCert,
	framePop,
	popSigningBody,
	POP_NONCE_LENGTH
} from '@harborage/crypto/cap-cert';
import { SIGNING_ALG, SIG_CONTEXT } from '@harborage/crypto/compartments';
import { sign, signingKeypair } from '@harborage/crypto/hkdf-tree';
import { CAP_HEADER, POP_HEADER } from '@harborage/worker-lib/cap-cert';
import { app } from '../src/app.ts';

// Media routes are dormant at M1 (document_intake OFF, presign creds unset). These
// prove the fail-closed gate and that untrusted input is rejected before any R2
// call, without needing live R2 or a real flag store.

/**
 * An env where document_intake reads OFF but the rate limiter allows.
 *
 * The ladder now runs BEFORE the flag read (throttle a flood before it can
 * spend a KV read), so the fail-closed status a caller sees is still 403 rather
 * than the limiter's 429 -- which is what this env pins.
 */
const closedEnv = {
	RATE_LIMIT: { idFromName: (n: string) => n, get: () => ({ allow: async () => true }) }
} as never;

// --- Real credentials, so the routes are exercised past their new gate -------
//
// Every /media/* route now requires a cap-cert plus a proof of possession bound
// to the exact bytes sent. Building genuine ones here keeps the input-validation
// assertions below meaningful: dropping them because a gate got stricter would
// trade one kind of coverage for none.

const SEED = new Uint8Array(32).fill(4);
const kp = signingKeypair(SEED);
const NOW = Date.now();

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
	return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
}

async function credentialed(path: string, body: unknown) {
	const text = JSON.stringify(body);
	const bytes = new TextEncoder().encode(text);
	const fields = {
		algId: SIGNING_ALG.ed25519,
		compartment: 'document' as const,
		issuedAtMs: NOW,
		expiresAtMs: NOW + 3600_000,
		publicKey: kp.publicKey
	};
	const cert = frameCapCert(fields, sign(SIG_CONTEXT.capCert, capCertBody(fields), SEED));
	const nonce = new Uint8Array(POP_NONCE_LENGTH);
	crypto.getRandomValues(nonce);
	const message = popSigningBody({
		certHash: await sha256(cert),
		method: 'POST',
		path,
		timestampMs: NOW,
		nonce,
		bodyHash: await sha256(bytes)
	});
	const pop = framePop(NOW, nonce, sign(SIG_CONTEXT.pop, message, SEED));
	const b64u = (b: Uint8Array) => {
		let out = '';
		for (const x of b) out += String.fromCharCode(x);
		return btoa(out).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
	};
	return {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			[CAP_HEADER]: b64u(cert),
			[POP_HEADER]: b64u(pop)
		},
		body: text
	};
}

/** A stub env with the flag ON, presign creds present, and a rate-limit verdict. */
function openEnv(rateAllows: boolean) {
	const flagRecord = JSON.stringify({ enabled: true, epoch: 1, updatedAt: '2026-07-25' });
	return {
		// document_intake ON, heightened_threat (and all else) OFF.
		FLAGS: { get: async (k: string) => (k === 'flag:document_intake' ? flagRecord : null) },
		R2_ACCOUNT_ID: 'acct',
		R2_PRESIGN_ACCESS_KEY_ID: 'AKIAEXAMPLE',
		R2_PRESIGN_SECRET_ACCESS_KEY: 'secretexample',
		RATE_LIMIT: {
			idFromName: (n: string) => n,
			// `allow` drives the broad rungs; `admit` is the per-credential rung
			// plus the single-use nonce, which every route now reaches.
			get: () => ({
				allow: async () => rateAllows,
				admit: async () => (rateAllows ? 'ok' : 'rate-limited')
			})
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

describe('media routes fail closed while document_intake is OFF', () => {
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
		const body = { key: 'k', uploadId: 'u', parts: [{ n: 1, etag: '"</ETag><x/>"' }] };
		const res = await app.request(
			'/media/complete',
			await credentialed('/media/complete', body),
			openEnv(true)
		);
		expect(res.status).toBe(400);
	});

	it('/media/derivative rejects a non-sha256 key with 400', async () => {
		const res = await app.request(
			'/media/derivative',
			await credentialed('/media/derivative', { sha256: 'not-a-hash' }),
			openEnv(true)
		);
		expect(res.status).toBe(400);
	});

	it('/media/part refuses a part number R2 would reject, before signing a URL', async () => {
		for (const partNumber of [0, -1, 10_001, 1.5]) {
			const body = { key: 'k', uploadId: 'u', partNumber };
			const res = await app.request(
				'/media/part',
				await credentialed('/media/part', body),
				openEnv(true)
			);
			expect(res.status, `partNumber ${partNumber}`).toBe(400);
		}
	});
});

/**
 * The gap this closes. `/media/create` mints a vault multipart upload, and
 * until now the only thing in front of it was an IP and ASN bucket -- no
 * per-caller identity, no replay protection, nothing to charge a rate limit
 * against. §7.6 sketches a "media upload ticket" from register; the cap-cert
 * and proof of possession the codebase already has do that job with no new
 * shared secret and no new state.
 */
describe('media routes require a per-request credential', () => {
	it.each(mutating)('%s returns 401 with no credential', async (path) => {
		const res = await app.request(
			path,
			{ method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
			openEnv(true)
		);
		expect(res.status).toBe(401);
	});

	it('refuses a proof of possession bound to a different body', async () => {
		const signedFor = await credentialed('/media/head', { key: 'the-key-i-signed' });
		const res = await app.request(
			'/media/head',
			{ ...signedFor, body: JSON.stringify({ key: 'a-different-key' }) },
			openEnv(true)
		);
		expect(res.status).toBe(401);
	});

	it('refuses a credential minted for a different route', async () => {
		const res = await app.request(
			'/media/abort',
			await credentialed('/media/create', { key: 'k', uploadId: 'u' }),
			openEnv(true)
		);
		expect(res.status).toBe(401);
	});
});
