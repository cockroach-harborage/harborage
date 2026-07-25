/**
 * Context-bound signature verification, with NO ambient globals (§17.6).
 *
 * Split out of device-keys.ts so a Worker can verify what a browser signed.
 * device-keys.ts reaches `globalThis.crypto` for key custody, which fails
 * typecheck in a Workers-typed package; this file touches only @noble.
 *
 * It is also the single place that knows the two ECDSA landmines below. That
 * knowledge existing in exactly one place is the point: it cost real debugging
 * time once and would cost it again if duplicated.
 */
import { ed25519 } from '@noble/curves/ed25519.js';
import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';
import {
	domainSeparate,
	SIGNATURE_LENGTH,
	SIGNING_ALG,
	type SigContext,
	type SigningAlgId
} from './compartments.ts';

/**
 * Verify `signature` over `message` under `context` for `algId`.
 * Returns false rather than throwing: every input here is untrusted.
 */
export function verifyContextSignature(
	algId: SigningAlgId,
	publicKey: Uint8Array,
	signature: Uint8Array,
	context: SigContext,
	message: Uint8Array
): boolean {
	if (signature.length !== SIGNATURE_LENGTH) return false;
	const framed = domainSeparate(context, message);
	try {
		if (algId === SIGNING_ALG.ed25519) return ed25519.verify(signature, framed, publicKey);
		if (algId === SIGNING_ALG.ecdsaP256) {
			// Both options are load-bearing and both defaults are wrong here:
			//
			// prehash:false — noble defaults to prehash:true, which hashes the
			//   argument for you. WebCrypto already signed SHA-256(framed), so we
			//   hand over that digest and must stop noble hashing it again.
			//
			// lowS:false — noble defaults to rejecting high-S signatures, and
			//   WebCrypto does not normalise S. About half of every genuine
			//   signature from our own P-256 tier has high S, so the default
			//   rejects them at random. Malleability matters where a signature is
			//   an identifier; here replay is bound by the PoP nonce, not by
			//   signature bytes, so accepting both forms of S costs nothing.
			//
			// Left at the defaults this fails ~50% of the time, and only on the
			// phones that need the fallback tier.
			return p256.verify(signature, sha256(framed), publicKey, { prehash: false, lowS: false });
		}
		return false;
	} catch {
		return false;
	}
}
