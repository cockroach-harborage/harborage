/**
 * The citable identifier for an archived item (ARCHITECTURE §16).
 *
 * `HRB-<base32(sha256(original)[:10])>`. DERIVED, never allocated: two systems
 * holding the same bytes compute the same id with no coordination and no
 * counter, so an id cannot leak submission order the way a sequence would. Ten
 * bytes give 80 bits, which is far past collision relevance for this corpus and
 * short enough to read aloud or write on paper.
 *
 * RFC 4648 base32 without padding, ~25 lines inline rather than a dependency:
 * per CLAUDE.md, check whether thirty lines does the job before adding one.
 */

export const CITABLE_PREFIX = 'HRB-';
export const CITABLE_ANCHOR_BYTES = 10;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const ID_RE = /^HRB-[A-Z2-7]{16}(\.v[1-9][0-9]*)?$/;

function base32(bytes: Uint8Array): string {
	let out = '';
	let buffer = 0;
	let bits = 0;
	for (const byte of bytes) {
		buffer = (buffer << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			out += ALPHABET[(buffer >> (bits - 5)) & 31];
			bits -= 5;
		}
	}
	if (bits > 0) out += ALPHABET[(buffer << (5 - bits)) & 31];
	return out;
}

function unhex(hex: string): Uint8Array {
	const out = new Uint8Array(hex.length / 2);
	for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	return out;
}

export function citableId(originalSha256Hex: string): string {
	if (!/^[0-9a-f]{64}$/.test(originalSha256Hex)) {
		throw new Error('original_sha256 must be 64 lowercase hex characters');
	}
	return CITABLE_PREFIX + base32(unhex(originalSha256Hex).slice(0, CITABLE_ANCHOR_BYTES));
}

export function isCitableId(value: string): boolean {
	return ID_RE.test(value);
}

/**
 * A re-rendered derivative gets a version suffix, never a new base id.
 *
 * The evidentiary identity is the pristine original's digest. Re-encoding the
 * public copy at a better quality must not make a citation in a filing point at
 * nothing, so the base is stable and the version says which rendering.
 */
export function versionedCitableId(id: string, version: number): string {
	if (!isCitableId(id)) throw new Error('not a citable id');
	if (!Number.isInteger(version) || version < 1) throw new Error('version must be >= 1');
	const base = id.split('.')[0]!;
	return version === 1 ? base : `${base}.v${version}`;
}
