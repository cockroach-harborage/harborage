/**
 * One-shot credential minting (ARCHITECTURE §5.1, §17.6; CLAUDE.md §3).
 *
 * Pure and `$lib`-free, in the same spirit as identity-core / outbox-core /
 * wipe-core: no IndexedDB handle is in scope here, so "this writes nothing" is
 * a property of the module's shape rather than a claim about its behaviour.
 *
 * WHAT A ONE-SHOT IDENTITY IS FOR. The brokered compartments (`medical`, `aid`)
 * must leave nothing on the device. A long-lived compartment key sitting in
 * IndexedDB is, on a seized phone, a durable statement that this person used the
 * medical broker, and it links every request that key ever signed. So instead of
 * installing a key at account creation, each request derives a fresh signing key
 * from the HKDF root, uses it once, and drops it.
 *
 * The derivation is `deriveRequestSeed(root, compartment, epoch, nonce)`, which
 * is byte-identical to the pure `requestSeed()` in @harborage/crypto/hkdf-tree
 * and has had no production caller since it was written in M2. This is it.
 *
 * HONEST LIMIT, and it must not be overstated. Unlinkability here is at the
 * key layer only. Two requests signed by two one-shot keys are unlinkable to a
 * server reading signatures, and are trivially linkable by source IP, by TLS
 * session, by timing, and by anything in the content. On the web that is the
 * real bound, which is why the medical routes are onion-only.
 */
import {
	capCertBody,
	frameCapCert,
	framePop,
	popSigningBody,
	POP_NONCE_LENGTH,
	type CapCertFields
} from '@harborage/crypto/cap-cert';
import { SIG_CONTEXT, type Compartment } from '@harborage/crypto/compartments';
import {
	importSigningKey,
	deriveRequestSeed,
	signWithDeviceKey,
	zero,
	type CustodyTier
} from '@harborage/crypto/device-keys';

/**
 * Life of a per-request certificate. Two minutes, well inside the twelve the
 * server will tolerate: a certificate minted for one request has no business
 * claiming to outlive the round trip, and the slack is for clock skew only.
 */
export const ONE_SHOT_CERT_TTL_MS = 2 * 60_000;

/**
 * Bytes of randomness that pick the HKDF leaf.
 *
 * A SECOND NONCE, DISTINCT FROM THE PROOF NONCE, on purpose. The proof nonce
 * travels on the wire and its freshness is a SERVER policy; if that policy were
 * ever loosened, reusing it as the derivation input would start reusing keys.
 * Key uniqueness must not depend on a rule someone else can relax. This one
 * never leaves the device.
 */
export const DERIVATION_NONCE_LEN = 16;

export interface OneShotContext {
	/** The non-extractable HKDF root. */
	root: CryptoKey;
	tier: CustodyTier;
	epoch: number;
}

function b64u(bytes: Uint8Array): string {
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
	return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
}

/**
 * Mint a certificate and a proof for exactly one request, from a key that has
 * never existed before and will not exist after.
 *
 * THERE IS NO CACHE HERE AND THERE MUST NOT BE. Two calls with identical
 * arguments produce different certificates, because the derivation nonce is
 * fresh each time. `credential-roundtrip.test.ts` asserts that the two public
 * keys differ, so adding a cache turns that test red rather than quietly
 * restoring linkability.
 *
 * `rng` and `nowMs` are parameters so the test can pin them. Production passes
 * `crypto.getRandomValues` and `Date.now`.
 */
export async function buildOneShotHeaders(
	ctx: OneShotContext,
	compartment: Compartment,
	method: string,
	path: string,
	body: Uint8Array,
	rng: (n: number) => Uint8Array,
	nowMs: number
): Promise<Record<string, string>> {
	const derivationNonce = rng(DERIVATION_NONCE_LEN);
	const seed = await deriveRequestSeed(ctx.root, compartment, ctx.epoch, derivationNonce);
	let key;
	try {
		key = await importSigningKey(seed, ctx.tier);
	} finally {
		// The seed exists as bytes for exactly as long as the import takes, same
		// discipline as installTree.
		zero(seed);
	}
	zero(derivationNonce);

	const fields: CapCertFields = {
		algId: key.algId,
		compartment,
		issuedAtMs: nowMs,
		expiresAtMs: nowMs + ONE_SHOT_CERT_TTL_MS,
		publicKey: key.publicKey
	};
	const certBody = capCertBody(fields);
	const certBytes = frameCapCert(
		fields,
		await signWithDeviceKey(key, SIG_CONTEXT.capCert, certBody)
	);

	const popNonce = rng(POP_NONCE_LENGTH);
	// One clock read: the signed body and the framed proof must carry the same
	// timestamp, and two reads can straddle a millisecond.
	const signed = popSigningBody({
		certHash: await sha256(certBytes),
		method,
		path,
		timestampMs: nowMs,
		nonce: popNonce,
		bodyHash: await sha256(body)
	});
	const signature = await signWithDeviceKey(key, SIG_CONTEXT.pop, signed);

	return {
		'X-HB-Cap': b64u(certBytes),
		'X-HB-PoP': b64u(framePop(nowMs, popNonce, signature))
	};
}
