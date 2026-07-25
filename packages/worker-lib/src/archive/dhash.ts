/**
 * 64-bit difference-hash helpers for near-duplicate lookup (ARCHITECTURE §16
 * Lever 1).
 *
 * The hash itself is computed ON THE CLIENT and is therefore
 * ATTACKER-CONTROLLED. A Worker cannot decode pixels, and the Images binding
 * reports dimensions rather than pixels, so there is no server-side alternative
 * today. Everything downstream treats this as advisory: it groups reposts under
 * one incident and feeds the recycled-media signal, and it never decides
 * keep-or-discard. It is recomputable server-side later from bytes we already
 * hold, at which point a lying client is simply corrected.
 *
 * Banded LSH rather than a vector index: this is Hamming distance over 64 bits,
 * and Vectorize offers cosine, euclidean and dot product only.
 */

export const DHASH_HEX_LEN = 16;
export const BAND_COUNT = 4;
export const BAND_HEX_LEN = 4;
/** Radius treated as "probably the same picture". Advisory, never destructive. */
export const DEFAULT_HAMMING_RADIUS = 10;

const HEX_RE = /^[0-9a-f]{16}$/;

export function isDhash64(value: string): boolean {
	return HEX_RE.test(value);
}

/**
 * Split into four 16-bit bands. Two hashes within a small radius agree on at
 * least one band with high probability, so a candidate lookup is an indexed
 * equality on one band rather than a scan.
 */
export function bandsOf(dhashHex: string): [string, string, string, string] {
	if (!isDhash64(dhashHex)) throw new Error('dhash must be 16 lowercase hex characters');
	return [
		dhashHex.slice(0, 4),
		dhashHex.slice(4, 8),
		dhashHex.slice(8, 12),
		dhashHex.slice(12, 16)
	];
}

const POPCOUNT = new Uint8Array(16);
for (let i = 0; i < 16; i++) POPCOUNT[i] = (i & 1) + ((i >> 1) & 1) + ((i >> 2) & 1) + ((i >> 3) & 1);

/**
 * Hamming distance in BITS.
 *
 * Counting differing hex characters instead would pass every plausible test and
 * be wrong by up to 4x: '0' against 'f' is one character and four bits. A
 * character-wise implementation reports 1, silently tightening the radius until
 * genuine near-duplicates stop matching.
 */
export function hammingDistance(a: string, b: string): number {
	if (!isDhash64(a) || !isDhash64(b)) throw new Error('dhash must be 16 lowercase hex characters');
	let bits = 0;
	for (let i = 0; i < DHASH_HEX_LEN; i++) {
		const x = Number.parseInt(a[i]!, 16) ^ Number.parseInt(b[i]!, 16);
		bits += POPCOUNT[x]!;
	}
	return bits;
}

export function isNearDuplicate(a: string, b: string, radius = DEFAULT_HAMMING_RADIUS): boolean {
	return hammingDistance(a, b) <= radius;
}
