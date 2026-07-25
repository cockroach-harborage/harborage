/**
 * Round-trip: a credential built the way the BROWSER builds it must verify
 * with the code the WORKER runs.
 *
 * The two halves live in different packages, use different key custody
 * (non-extractable WebCrypto against raw noble) and, on the P-256 tier,
 * different signing implementations entirely. Unit-testing each side alone
 * would let them drift into a state where every test is green and no real
 * request is ever accepted.
 *
 * It lives in apps/web rather than worker-lib because it needs BOTH sides, and
 * importing device-keys.ts into a Workers-typed package drags globalThis.crypto
 * into that package's tsc and fails the build. apps/web is the only workspace
 * that legitimately has DOM types and depends on both packages.
 *
 * It runs on Node's WebCrypto; the browser side is covered by Playwright.
 */
import { describe, expect, it } from 'vitest';
import {
	capCertBody,
	frameCapCert,
	framePop,
	popSigningBody,
	unframeCapCert,
	POP_NONCE_LENGTH,
	type CapCertFields
} from '@harborage/crypto/cap-cert';
import { SIG_CONTEXT } from '@harborage/crypto/compartments';
import {
	importRootKey,
	importSigningKey,
	signWithDeviceKey,
	type CustodyTier
} from '@harborage/crypto/device-keys';
import { CAP_HEADER, POP_HEADER, verifyRequestCredential } from '@harborage/worker-lib/cap-cert';
import { buildOneShotHeaders, type OneShotContext } from '../src/lib/credential-core.ts';

const URL_REGISTER = 'https://cockroachharborage.org/api/incidents/register';
const BODY = new TextEncoder().encode('{"sealed":true}');

function b64u(bytes: Uint8Array): string {
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
	return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
}

function fromB64u(s: string): Uint8Array {
	const b64 = s.replaceAll('-', '+').replaceAll('_', '/');
	const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='));
	return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Mirrors apps/web/src/lib/credential.ts, using the same device-key API. */
async function mintCredential(tier: CustodyTier, nowMs: number, body = BODY) {
	const key = await importSigningKey(new Uint8Array(32).fill(21), tier);
	const fields: CapCertFields = {
		algId: key.algId,
		compartment: 'document',
		issuedAtMs: nowMs,
		expiresAtMs: nowMs + 3600_000,
		publicKey: key.publicKey
	};
	const certBytes = frameCapCert(
		fields,
		await signWithDeviceKey(key, SIG_CONTEXT.capCert, capCertBody(fields))
	);

	const nonce = new Uint8Array(POP_NONCE_LENGTH);
	crypto.getRandomValues(nonce);
	const signed = popSigningBody({
		certHash: await sha256(certBytes),
		method: 'POST',
		path: '/api/incidents/register',
		timestampMs: nowMs,
		nonce,
		bodyHash: await sha256(body)
	});
	const popBytes = framePop(nowMs, nonce, await signWithDeviceKey(key, SIG_CONTEXT.pop, signed));

	return {
		[CAP_HEADER]: b64u(certBytes),
		[POP_HEADER]: b64u(popBytes)
	};
}

function request(headers: Record<string, string>) {
	return {
		method: 'POST',
		url: URL_REGISTER,
		headers: { get: (name: string) => headers[name] ?? null }
	};
}

describe.each<CustodyTier>(['secure-curve', 'p256'])(
	'credential round-trip on the %s tier',
	(tier) => {
		it('is accepted by the worker verifier', async () => {
			const nowMs = Date.now();
			const headers = await mintCredential(tier, nowMs);
			const result = await verifyRequestCredential(request(headers), BODY, {
				nowMs,
				compartment: 'document'
			});
			expect(result.ok).toBe(true);
		});

		// ECDSA is randomised and half its signatures have high S. A single pass
		// here would be a coin flip on the fallback tier, which is exactly the bug
		// class that reached production once already.
		it('is accepted every time, not most of the time', async () => {
			for (let i = 0; i < 24; i++) {
				const nowMs = Date.now();
				const headers = await mintCredential(tier, nowMs);
				const result = await verifyRequestCredential(request(headers), BODY, {
					nowMs,
					compartment: 'document'
				});
				expect(result.ok, `iteration ${i} rejected`).toBe(true);
			}
		});

		it('is rejected when the body it was bound to changes', async () => {
			const nowMs = Date.now();
			const headers = await mintCredential(tier, nowMs);
			const result = await verifyRequestCredential(
				request(headers),
				new TextEncoder().encode('{"sealed":false}'),
				{ nowMs, compartment: 'document' }
			);
			expect(result.ok).toBe(false);
		});
	}
);

/**
 * ONE-SHOT ROUND TRIP.
 *
 * Exercises the real client function (buildOneShotHeaders) against the real
 * worker verifier, on both custody tiers. Importantly it drives the actual
 * module rather than a mirror of it, so the "never caches" property below is a
 * statement about shipping code.
 */
const AID_URL = 'https://cockroachharborage.org/api/aid/need';
const AID_PATH = '/api/aid/need';

function aidRequest(headers: Record<string, string>) {
	return {
		method: 'POST',
		url: AID_URL,
		headers: { get: (name: string) => headers[name] ?? null }
	};
}

/** Deterministic randomness, so a rejection is reproducible. */
function seqRng(start: number): (n: number) => Uint8Array {
	let c = start;
	return (n: number) => {
		const out = new Uint8Array(n);
		for (let i = 0; i < n; i++) out[i] = (c = (c * 1103515245 + 12345) >>> 0) & 0xff;
		return out;
	};
}

async function oneShotCtx(tier: CustodyTier): Promise<OneShotContext> {
	const seed = new Uint8Array(64).fill(33);
	return { root: await importRootKey(seed), tier, epoch: 1 };
}

describe.each<CustodyTier>(['secure-curve', 'p256'])(
	'one-shot credential on the %s tier',
	(tier) => {
		it('is accepted by the worker verifier under one-shot admission', async () => {
			const nowMs = Date.now();
			const headers = await buildOneShotHeaders(
				await oneShotCtx(tier),
				'aid',
				'POST',
				AID_PATH,
				BODY,
				seqRng(1),
				nowMs
			);
			const result = await verifyRequestCredential(aidRequest(headers), BODY, {
				nowMs,
				compartment: 'aid',
				admission: 'one-shot'
			});
			expect(result.ok).toBe(true);
		});

		// Same coin-flip reasoning as the cached path: ECDSA is randomised and half
		// its signatures have high S.
		it('is accepted every time, not most of the time', async () => {
			const ctx = await oneShotCtx(tier);
			for (let i = 0; i < 24; i++) {
				const nowMs = Date.now();
				const headers = await buildOneShotHeaders(
					ctx,
					'aid',
					'POST',
					AID_PATH,
					BODY,
					seqRng(100 + i),
					nowMs
				);
				const result = await verifyRequestCredential(aidRequest(headers), BODY, {
					nowMs,
					compartment: 'aid',
					admission: 'one-shot'
				});
				expect(result.ok, `iteration ${i} rejected`).toBe(true);
			}
		});

		/**
		 * THE TEST THAT ENFORCES "NEVER CACHES".
		 *
		 * Two calls with byte-identical arguments must produce different signing
		 * keys. Add a cache to buildOneShotHeaders or oneShotCredentialHeaders and
		 * this goes red, rather than linkability across brokered requests being
		 * quietly restored with every other test still green.
		 */
		it('mints a different key for every call', async () => {
			const ctx = await oneShotCtx(tier);
			const nowMs = Date.now();
			const a = await buildOneShotHeaders(ctx, 'aid', 'POST', AID_PATH, BODY, seqRng(7), nowMs);
			const b = await buildOneShotHeaders(ctx, 'aid', 'POST', AID_PATH, BODY, seqRng(8), nowMs);

			const pubA = unframeCapCert(fromB64u(a[CAP_HEADER]!))?.publicKey;
			const pubB = unframeCapCert(fromB64u(b[CAP_HEADER]!))?.publicKey;
			expect(pubA).toBeDefined();
			expect(pubB).toBeDefined();
			expect(Array.from(pubB!)).not.toEqual(Array.from(pubA!));
		});

		it('is rejected when the body it was bound to changes', async () => {
			const nowMs = Date.now();
			const headers = await buildOneShotHeaders(
				await oneShotCtx(tier),
				'aid',
				'POST',
				AID_PATH,
				BODY,
				seqRng(3),
				nowMs
			);
			const result = await verifyRequestCredential(
				aidRequest(headers),
				new TextEncoder().encode('{"sealed":false}'),
				{ nowMs, compartment: 'aid', admission: 'one-shot' }
			);
			expect(result.ok).toBe(false);
		});

		/** The server rule, reached from the real client path. */
		it('is refused when the endpoint did not ask for one-shot admission', async () => {
			const nowMs = Date.now();
			const headers = await buildOneShotHeaders(
				await oneShotCtx(tier),
				'aid',
				'POST',
				AID_PATH,
				BODY,
				seqRng(5),
				nowMs
			);
			const result = await verifyRequestCredential(aidRequest(headers), BODY, {
				nowMs,
				compartment: 'aid'
			});
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.reason).toBe('one-shot-required');
		});
	}
);
