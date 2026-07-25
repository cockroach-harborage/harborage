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
/** Anonymous sealed box: ephemeral X25519 ‖ nonce ‖ ciphertext (§19.1). */
export const ALG_SEALED_BOX_X25519 = 2;
/**
 * Evidence-vault content-key ring (§5.4): several sealed boxes, each to a
 * DIFFERENT off-platform holder, under one header binding them to one file.
 *
 * Its own algorithm id rather than reusing 2, because the custody claim differs
 * and should be legible on the wire: no platform key opens any copy in a
 * keyring, and `gate-sealed-body` records that as a distinct sealed object.
 */
export const ALG_VAULT_KEYRING = 3;
/**
 * Brokered one-shot frame (§5.3, M4). Routing prefix in the clear, then a
 * sealed box to the counterparty's one-shot prekey, then padding to a FIXED
 * length.
 *
 * Its own algorithm id because the size rule differs: every brokered body is
 * exactly BROKER_ENVELOPE_LEN, in both the announce and the reveal phase. Two
 * phases of different sizes would be a phase oracle visible to anyone watching
 * the connection, so uniform framing is a confidentiality property here rather
 * than tidiness. The routing fields are in the clear because the Broker has to
 * route on them; putting them inside the signed body makes that disclosure
 * explicit and covered by the proof of possession, instead of hiding it in a
 * mutable header while calling the body opaque.
 */
export const ALG_BROKER_ONESHOT = 4;

const HEADER_LEN = MAGIC.length + 1; // magic + algId
const SEAL_MIN = 24 + 16; // nonce + Poly1305 tag
const SEALED_BOX_MIN = 32 + SEAL_MIN; // ephemeral public key + nonce + tag
/** version + tier + original digest + copy count, then at least one copy. */
const KEYRING_MIN = 1 + 1 + 32 + 1 + (1 + 2 + SEALED_BOX_MIN);

/**
 * The one size a brokered body may be, minimum and maximum both.
 *
 * Big enough for the routing prefix, a sealed box and a short structured card;
 * small enough that a 2G phone can send one, and that padding every message to
 * it is not wasteful.
 */
export const BROKER_ENVELOPE_LEN = 4 * 1024;

/**
 * Shortest framed envelope PER ALGORITHM. A single global minimum would let a
 * sealed-box body be truncated to a bare 45 bytes and still look structurally
 * valid, so the floor moves with the algorithm the header declares.
 */
const MIN_BY_ALG = new Map<number, number>([
	[ALG_XCHACHA20POLY1305, HEADER_LEN + SEAL_MIN],
	[ALG_SEALED_BOX_X25519, HEADER_LEN + SEALED_BOX_MIN],
	[ALG_VAULT_KEYRING, HEADER_LEN + KEYRING_MIN],
	[ALG_BROKER_ONESHOT, BROKER_ENVELOPE_LEN]
]);

/** Shortest possible framed envelope of any algorithm. */
export const MIN_ENVELOPE_LEN = HEADER_LEN + SEAL_MIN; // 45
/** Register metadata is < 4 KiB (§19.1); cap the sealed body well under that. */
export const MAX_ENVELOPE_LEN = 8 * 1024;

/**
 * Longest framed envelope PER ALGORITHM, mirroring MIN_BY_ALG.
 *
 * The single global ceiling was fine while every lane wanted "not enormous".
 * The broker lane wants something stricter: EXACTLY one size, so an observer
 * cannot tell an announce from a reveal, or an empty poll from a delivering
 * one, by counting bytes. A per-algorithm maximum equal to its minimum is how
 * that becomes a structural property of the framing rather than a rule each
 * handler has to remember.
 */
const MAX_BY_ALG = new Map<number, number>([
	[ALG_XCHACHA20POLY1305, MAX_ENVELOPE_LEN],
	[ALG_SEALED_BOX_X25519, MAX_ENVELOPE_LEN],
	[ALG_VAULT_KEYRING, MAX_ENVELOPE_LEN],
	[ALG_BROKER_ONESHOT, BROKER_ENVELOPE_LEN]
]);

/** Ceiling for one algorithm. Handlers use this for the content-length precheck. */
export function maxEnvelopeLen(algId: number): number {
	return MAX_BY_ALG.get(algId) ?? MAX_ENVELOPE_LEN;
}

const KNOWN_ALGS = new Set<number>([
	ALG_XCHACHA20POLY1305,
	ALG_SEALED_BOX_X25519,
	ALG_VAULT_KEYRING,
	ALG_BROKER_ONESHOT
]);

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
	if (algId === undefined || !KNOWN_ALGS.has(algId)) return false;
	if (buf.length < (MIN_BY_ALG.get(algId) ?? MIN_ENVELOPE_LEN)) return false;
	// The per-algorithm ceiling, checked after the global one so an enormous body
	// is refused before the header is even read.
	return buf.length <= maxEnvelopeLen(algId);
}

/** Split a framed envelope into {algId, sealed}, or null if malformed. */
export function unframeEnvelope(buf: Uint8Array): { algId: number; sealed: Uint8Array } | null {
	if (!isSealedEnvelope(buf)) return null;
	return { algId: buf[MAGIC.length]!, sealed: buf.subarray(HEADER_LEN) };
}
