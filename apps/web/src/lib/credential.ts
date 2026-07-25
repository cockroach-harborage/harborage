/**
 * Client half of the per-request credential (ARCHITECTURE §17.6).
 *
 * Mints a self-issued cap-cert from the compartment key held in identity.ts,
 * and a fresh proof of possession per request. The certificate authorises
 * nothing and is free to mint — see @harborage/crypto/cap-cert for why that is
 * the point rather than a weakness.
 *
 * Both halves are signed with the non-extractable device key, so the private
 * material never appears in this file or anywhere else as bytes.
 */
import {
	capCertBody,
	frameCapCert,
	framePop,
	popSigningBody,
	POP_NONCE_LENGTH,
	type CapCertFields
} from '@harborage/crypto/cap-cert';
import {
	ONE_SHOT_ONLY_COMPARTMENTS,
	SIG_CONTEXT,
	type Compartment
} from '@harborage/crypto/compartments';
import { signingAlgFor, publicKeyFor, sign, oneShotContext } from '$lib/identity';
import { buildOneShotHeaders } from '$lib/credential-core';

/**
 * Certificates are cached in memory for a fraction of their life so a burst of
 * requests does not re-sign one each time, and are never persisted: a
 * certificate on disk is a credential someone can lift off a seized phone,
 * and re-deriving one costs a single signature.
 */
const CERT_TTL_MS = 60 * 60_000;
const CERT_REUSE_MS = 30 * 60_000;

interface CachedCert {
	bytes: Uint8Array;
	hash: Uint8Array;
	mintedAtMs: number;
}

const cache = new Map<Compartment, CachedCert>();

function b64u(bytes: Uint8Array): string {
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
	return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
}

async function certFor(compartment: Compartment): Promise<CachedCert> {
	// The client-side mirror of the server's one-shot rule. Without it a caller
	// could reach the cache with 'aid' by habit, mint an hour-long reusable
	// certificate, and re-link every brokered request it signed. The server would
	// reject it, but only after the linkable certificate had already been built
	// and sent, so the refusal belongs here too.
	if (ONE_SHOT_ONLY_COMPARTMENTS.includes(compartment))
		throw new Error(`${compartment} is one-shot only; use oneShotCredentialHeaders`);

	const cached = cache.get(compartment);
	const now = Date.now();
	if (cached && now - cached.mintedAtMs < CERT_REUSE_MS) return cached;

	const publicKey = await publicKeyFor(compartment);
	const algId = await signingAlgFor(compartment);
	if (!publicKey || algId === null) throw new Error('no account on this device');

	const fields: CapCertFields = {
		algId,
		compartment,
		issuedAtMs: now,
		expiresAtMs: now + CERT_TTL_MS,
		publicKey
	};
	const body = capCertBody(fields);
	const bytes = frameCapCert(fields, await sign(compartment, SIG_CONTEXT.capCert, body));
	const minted: CachedCert = { bytes, hash: await sha256(bytes), mintedAtMs: now };
	cache.set(compartment, minted);
	return minted;
}

/**
 * Headers proving this exact request. A fresh nonce per call is required, not
 * merely polite: the server remembers nonces, so reusing one on a retry would
 * be rejected as a replay.
 */
export async function credentialHeaders(
	compartment: Compartment,
	method: string,
	path: string,
	body: Uint8Array
): Promise<Record<string, string>> {
	const cert = await certFor(compartment);
	const nonce = new Uint8Array(POP_NONCE_LENGTH);
	crypto.getRandomValues(nonce);

	// Read the clock once: the signed body and the framed proof must carry the
	// same timestamp, and two Date.now() calls can straddle a millisecond.
	const timestampMs = Date.now();
	const signed = popSigningBody({
		certHash: cert.hash,
		method,
		path,
		timestampMs,
		nonce,
		bodyHash: await sha256(body)
	});
	const signature = await sign(compartment, SIG_CONTEXT.pop, signed);
	return {
		'X-HB-Cap': b64u(cert.bytes),
		'X-HB-PoP': b64u(framePop(timestampMs, nonce, signature))
	};
}

/**
 * Headers for a brokered request, from a key that exists for this call only.
 *
 * NEVER CACHES, and there is nothing here to cache into: no `cache.set`, no
 * IndexedDB write, no `meta.publicKeys` entry. Two calls with identical
 * arguments produce different certificates. That is asserted directly in
 * credential-roundtrip.test.ts by comparing the two certificates' public keys,
 * so adding a cache here turns a test red rather than quietly reintroducing
 * linkability across brokered requests.
 */
export async function oneShotCredentialHeaders(
	compartment: Compartment,
	method: string,
	path: string,
	body: Uint8Array
): Promise<Record<string, string>> {
	const ctx = await oneShotContext(compartment);
	return buildOneShotHeaders(
		ctx,
		compartment,
		method,
		path,
		body,
		(n) => {
			const b = new Uint8Array(n);
			crypto.getRandomValues(b);
			return b;
		},
		Date.now()
	);
}

/** Drop cached certificates, e.g. after a wipe or a compartment rotation. */
export function forgetCredentials(): void {
	cache.clear();
}
