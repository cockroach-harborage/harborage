/**
 * Request-credential policy: header parsing, clocks, compartment, replay
 * (ARCHITECTURE §17.6). The byte layout lives in @harborage/crypto/cap-cert;
 * this file decides whether a parsed credential is acceptable RIGHT NOW.
 *
 * The split matters. Format is frozen and shared with the client. Policy is
 * server-side, tunable, and fails closed: every path that is not an explicit
 * success returns a reason, and the caller turns that into a status.
 *
 * What a valid credential proves: the sender holds the private half of this
 * public key, in this compartment, for this exact method+path+body, once.
 * What it does NOT prove: that the holder is a person, is trusted, or is
 * allowed to do anything. A cap-cert is self-issued and free to mint
 * (@harborage/crypto/cap-cert says so at length). Personhood is Turnstile,
 * volume is the rate ladder, standing is reputation.
 */
import {
	capCertSelfSignatureValid,
	isCapCert,
	popSignatureValid,
	unframeCapCert,
	unframePop,
	type CapCert,
	type Pop
} from '@harborage/crypto/cap-cert';
import { ACTIVE_COMPARTMENTS, type Compartment } from '@harborage/crypto/compartments';

export const CAP_HEADER = 'X-HB-Cap';
export const POP_HEADER = 'X-HB-PoP';

/**
 * Clock policy. A phone's clock is often wrong, sometimes by minutes, and a
 * protestor cannot be told to fix it. The skew allowance is generous; the
 * replay window is what actually bounds a captured proof, and it is short.
 */
export const DEFAULT_POLICY = {
	/** How far a client clock may run ahead or behind us. */
	maxSkewMs: 5 * 60_000,
	/** A PoP older than this is stale even inside the skew allowance. */
	popWindowMs: 2 * 60_000,
	/** Longest life a self-issued certificate may claim. */
	maxTtlMs: 24 * 60 * 60_000
} as const;

export type CapCertPolicy = {
	nowMs: number;
	maxSkewMs?: number;
	popWindowMs?: number;
	maxTtlMs?: number;
	/** Which compartment this endpoint serves. */
	compartment: Compartment;
};

export type CredentialFailure =
	| 'missing'
	| 'two-compartment'
	| 'malformed-cert'
	| 'malformed-pop'
	| 'cert-not-yet-valid'
	| 'cert-expired'
	| 'cert-ttl-too-long'
	| 'cert-bad-signature'
	| 'wrong-compartment'
	| 'inactive-compartment'
	| 'pop-stale'
	| 'pop-future'
	| 'pop-bad-signature';

export type CredentialResult =
	| { ok: true; cert: CapCert; pop: Pop; certHashHex: string; nonceHex: string }
	| { ok: false; reason: CredentialFailure };

function fail(reason: CredentialFailure): CredentialResult {
	return { ok: false, reason };
}

function hex(bytes: Uint8Array): string {
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Tolerant of padding and of the URL-safe alphabet; strict about junk. */
function fromBase64Url(value: string): Uint8Array | null {
	const normalized = value.trim().replaceAll('-', '+').replaceAll('_', '/');
	if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) return null;
	try {
		const binary = atob(normalized);
		const out = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
		return out;
	} catch {
		return null;
	}
}

async function sha256Hex(bytes: Uint8Array): Promise<Uint8Array> {
	const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
	return new Uint8Array(digest);
}

/**
 * Verify the credential on a request.
 *
 * `body` is the exact bytes the handler read, so the proof binds to the
 * content that will actually be processed rather than to a re-read stream.
 *
 * Replay is NOT checked here — it needs the single-threaded memory DO, and
 * doing it in a pure function would be a lie. The caller must pass `nonceHex`
 * to RateLimit.admit() and treat a non-'ok' verdict as a rejection.
 */
export async function verifyRequestCredential(
	req: { method: string; url: string; headers: { get(name: string): string | null } },
	body: Uint8Array,
	policy: CapCertPolicy
): Promise<CredentialResult> {
	const capHeader = req.headers.get(CAP_HEADER);
	const popHeader = req.headers.get(POP_HEADER);
	if (!capHeader || !popHeader) return fail('missing');

	// Workers join repeated headers with ", ". Two credentials on one request
	// is the two-compartment case the charter forbids: one compartment per
	// session, enforced. Refuse rather than picking one.
	if (capHeader.includes(',') || popHeader.includes(',')) return fail('two-compartment');

	const certBytes = fromBase64Url(capHeader);
	if (!certBytes || !isCapCert(certBytes)) return fail('malformed-cert');
	const cert = unframeCapCert(certBytes);
	if (!cert) return fail('malformed-cert');

	const popBytes = fromBase64Url(popHeader);
	if (!popBytes) return fail('malformed-pop');
	const pop = unframePop(popBytes);
	if (!pop) return fail('malformed-pop');

	const maxSkewMs = policy.maxSkewMs ?? DEFAULT_POLICY.maxSkewMs;
	const popWindowMs = policy.popWindowMs ?? DEFAULT_POLICY.popWindowMs;
	const maxTtlMs = policy.maxTtlMs ?? DEFAULT_POLICY.maxTtlMs;
	const now = policy.nowMs;

	// Compartment before crypto: it is the cheapest check and the one whose
	// failure means the client is confused rather than hostile.
	if (cert.compartment !== policy.compartment) return fail('wrong-compartment');
	if (!ACTIVE_COMPARTMENTS.includes(cert.compartment)) return fail('inactive-compartment');

	if (cert.expiresAtMs <= cert.issuedAtMs) return fail('cert-expired');
	if (cert.expiresAtMs - cert.issuedAtMs > maxTtlMs) return fail('cert-ttl-too-long');
	if (cert.issuedAtMs - now > maxSkewMs) return fail('cert-not-yet-valid');
	if (now - cert.expiresAtMs > maxSkewMs) return fail('cert-expired');

	if (pop.timestampMs - now > maxSkewMs) return fail('pop-future');
	if (now - pop.timestampMs > popWindowMs + maxSkewMs) return fail('pop-stale');

	if (!capCertSelfSignatureValid(cert)) return fail('cert-bad-signature');

	const certHash = await sha256Hex(cert.bytes);
	const bodyHash = await sha256Hex(body);
	const path = new URL(req.url).pathname;
	if (!popSignatureValid(cert, pop, certHash, req.method, path, bodyHash))
		return fail('pop-bad-signature');

	return {
		ok: true,
		cert,
		pop,
		certHashHex: hex(certHash),
		nonceHex: hex(pop.nonce)
	};
}

/**
 * How long a nonce must be remembered: the whole span in which the same proof
 * could still pass the freshness check. Anything shorter reopens the replay
 * window at the edge of the allowance.
 */
export function nonceRetentionMs(policy: Pick<CapCertPolicy, 'popWindowMs' | 'maxSkewMs'>): number {
	return (
		(policy.popWindowMs ?? DEFAULT_POLICY.popWindowMs) +
		2 * (policy.maxSkewMs ?? DEFAULT_POLICY.maxSkewMs)
	);
}
