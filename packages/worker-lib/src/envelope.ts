/**
 * Sealed-envelope framing for sensitive intake bodies (design review; §17.5, §19.1).
 *
 * A sensitive-endpoint body is a client-side seal() output (packages/crypto:
 * nonce(24) || ciphertext+tag) wrapped with a 5-byte header. The intake Worker
 * holds no key and cannot decrypt; the header lets it STRUCTURALLY decide "is
 * this a sealed envelope?" and reject anything else (plain JSON, a form post, an
 * empty body). This proves only that the bytes are not plaintext masquerading as
 * a report — never that they decrypt. Both the client (after seal) and the api
 * Worker (before enqueue) use this module, so the check is deterministic.
 *
 * Wire layout:  MAGIC("HBE1", 4B) || algId(1B) || seal() output(nonce(24)||ct+tag)
 */

/** "HBE1" — Harborage Envelope v1. JSON never starts with 0x48, so this also rejects JSON. */
export const MAGIC = new Uint8Array([0x48, 0x42, 0x45, 0x31]);
export const ALG_XCHACHA20POLY1305 = 1;

const HEADER_LEN = MAGIC.length + 1; // magic + algId
const SEAL_MIN = 24 + 16; // nonce + Poly1305 tag
/** Shortest possible framed envelope: header + an empty-plaintext seal. */
export const MIN_ENVELOPE_LEN = HEADER_LEN + SEAL_MIN; // 45
/** Register metadata is < 4 KiB (§19.1); cap the sealed body well under that. */
export const MAX_ENVELOPE_LEN = 8 * 1024;

const KNOWN_ALGS = new Set<number>([ALG_XCHACHA20POLY1305]);

/** Wrap a seal() output for the wire. */
export function frameEnvelope(
	sealed: Uint8Array,
	algId: number = ALG_XCHACHA20POLY1305
): Uint8Array {
	const out = new Uint8Array(HEADER_LEN + sealed.length);
	out.set(MAGIC, 0);
	out[MAGIC.length] = algId & 0xff;
	out.set(sealed, HEADER_LEN);
	return out;
}

/**
 * Structural predicate — shape only, no key, no decryption. False for plain
 * JSON, oversize bodies, unknown algorithms, and anything shorter than one seal.
 */
export function isSealedEnvelope(buf: Uint8Array): boolean {
	if (buf.length < MIN_ENVELOPE_LEN || buf.length > MAX_ENVELOPE_LEN) return false;
	for (let i = 0; i < MAGIC.length; i++) {
		if (buf[i] !== MAGIC[i]) return false;
	}
	const algId = buf[MAGIC.length];
	return algId !== undefined && KNOWN_ALGS.has(algId);
}

/** Split a framed envelope into {algId, sealed}, or null if malformed. */
export function unframeEnvelope(buf: Uint8Array): { algId: number; sealed: Uint8Array } | null {
	if (!isSealedEnvelope(buf)) return null;
	return { algId: buf[MAGIC.length]!, sealed: buf.subarray(HEADER_LEN) };
}
