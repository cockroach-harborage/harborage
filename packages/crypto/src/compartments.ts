/**
 * Compartment vocabulary + signing-context registry (§5.1, §17.6).
 *
 * Two separate jobs, in one file because they are the two things every signed
 * artefact has to name: WHICH identity signed, and WHAT it signed as.
 *
 * 1. COMPARTMENTS — the closed set of unlinkable per-domain identities. The
 *    ordinal travels on the wire (cap-cert byte 3), so the list is
 *    APPEND-ONLY: never reorder, never remove, never reuse an ordinal. Names
 *    beyond the two active ones are reserved now so the frozen module does not
 *    have to grow later.
 *
 * 2. SIG_CONTEXT — a domain-separation tag per signed protocol. Without one,
 *    a signature is over raw bytes and the same key signing two protocols is
 *    cross-protocol confusable: a captured cap-cert signature could be
 *    presented as a proof-of-possession, or the reverse. The tag is framed
 *    length-first so the tag set is prefix-free and no message under one
 *    context can be reparsed as a message under another.
 *
 * No ambient globals, no randomness, no I/O — Workers import this directly.
 */

/**
 * Closed, APPEND-ONLY. Index = the ordinal that goes on the wire.
 *
 * Membership here is only a reserved NAME. Which of these a client may actually
 * use, and on what terms, is decided by the three lists below plus worker-side
 * policy. `community`, `accountability`, `curation` and `legal` are reserved and
 * refused today.
 */
export const COMPARTMENTS = [
	'document',
	'directory',
	'community',
	'accountability',
	'curation',
	'medical',
	'aid',
	'legal'
] as const;

export type Compartment = (typeof COMPARTMENTS)[number];

/**
 * Compartments the server will accept a capability certificate for.
 *
 * Widening this is a design change. It is NOT the same question as which
 * compartments a device keeps keys for, and conflating the two is how M4 nearly
 * shipped a new seizure exposure: see CACHED_COMPARTMENTS below.
 */
export const ACTIVE_COMPARTMENTS: readonly Compartment[] = [
	'document',
	'directory',
	'medical',
	'aid'
];

/**
 * Compartments whose long-lived keys are derived and STORED at account creation.
 *
 * WHY THIS IS A SEPARATE LIST. apps/web installs a key per active compartment
 * into IndexedDB when an account is made, so that a later send never has to
 * reach for the root key while the user is standing somewhere they need to
 * leave. That is right for `document` and `directory`, which are ordinary
 * pseudonymous surfaces.
 *
 * It is wrong for the brokered ones. Adding `medical` and `aid` to a single
 * combined list would have put a durable medical key on EVERY device at account
 * creation, including the overwhelming majority that never touch the broker. A
 * seized phone would then carry a stored artifact of a compartment its owner
 * never used, and one that is specifically incriminating. It would also double
 * the account-creation crypto on a cheap phone for keys most people never need.
 */
export const CACHED_COMPARTMENTS: readonly Compartment[] = ['document', 'directory'];

/**
 * Compartments reached ONLY through a per-request one-shot identity.
 *
 * A fresh signing key is derived from the HKDF root for each request and
 * discarded, so no long-lived key for these ever exists on the device and there
 * is nothing on a seized phone that says this person used the aid or medical
 * broker. The server enforces the same rule from the other side: a certificate
 * for one of these compartments is refused unless the endpoint asked for
 * one-shot admission.
 *
 * HONEST LIMIT. The server cannot actually tell a one-shot certificate from a
 * cached one, because both are ordinary self-issued cap-certs and which HKDF
 * leaf minted the key is invisible on the wire. What the server rule buys is a
 * short TTL clamp, which bounds the cost of being wrong. The property that this
 * device holds no stored key is a CLIENT property, kept by the client.
 */
export const ONE_SHOT_ONLY_COMPARTMENTS: readonly Compartment[] = ['medical', 'aid'];

export function isCompartment(value: string): value is Compartment {
	return (COMPARTMENTS as readonly string[]).includes(value);
}

export function compartmentOrdinal(compartment: Compartment): number {
	return COMPARTMENTS.indexOf(compartment);
}

/** Null for an unknown ordinal — a wire value is untrusted input, never a throw. */
export function compartmentFromOrdinal(ordinal: number): Compartment | null {
	if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= COMPARTMENTS.length) return null;
	return COMPARTMENTS[ordinal] ?? null;
}

// --- Signing algorithms ------------------------------------------------------
// Also a wire value (cap-cert byte 2), so also APPEND-ONLY. Two entries because
// the key-custody fallback ladder is real: Ed25519 is not on every phone yet,
// and P-256 has been universal for a decade. A verifier must be told which one
// it is looking at rather than guessing from a length.

export const SIGNING_ALG = {
	ed25519: 1,
	ecdsaP256: 2
} as const;

export type SigningAlgId = (typeof SIGNING_ALG)[keyof typeof SIGNING_ALG];

export function isSigningAlgId(value: number): value is SigningAlgId {
	return (Object.values(SIGNING_ALG) as number[]).includes(value);
}

/** Public-key length on the wire: raw Ed25519, or a compressed P-256 point. */
export const PUBLIC_KEY_LENGTH: Record<SigningAlgId, number> = {
	[SIGNING_ALG.ed25519]: 32,
	[SIGNING_ALG.ecdsaP256]: 33
};

/** Both produce a fixed 64-byte signature: Ed25519 R‖S, ECDSA raw r‖s. */
export const SIGNATURE_LENGTH = 64;

// --- Device-local epoch ------------------------------------------------------
// The epoch is how a user starts fresh in one compartment without touching the
// others. It is DEVICE-LOCAL and monotonic: it never comes from a server value,
// because a server that could move it could force key rotation on demand and
// watch which pseudonym disappears. It is also not on the wire — the public key
// is the identity, and the epoch only selects which key to derive.

export const FIRST_EPOCH = 1;
export const MAX_EPOCH = 2 ** 31 - 1;

export function isValidEpoch(value: unknown): value is number {
	return (
		Number.isInteger(value) && (value as number) >= FIRST_EPOCH && (value as number) <= MAX_EPOCH
	);
}

/** Next epoch, or null at the ceiling (start a new account rather than wrap). */
export function nextEpoch(current: number): number | null {
	if (!isValidEpoch(current) || current >= MAX_EPOCH) return null;
	return current + 1;
}

// --- Signing contexts --------------------------------------------------------

/**
 * Every distinct thing a compartment key may sign. `as const` is load-bearing:
 * without it the value type widens to `string` and TypeScript stops rejecting
 * an ad-hoc tag. gate-sig-context enforces the `as const`, the shared prefix,
 * the version suffix, and uniqueness.
 */
export const SIG_CONTEXT = {
	/** Self-issued capability certificate (the cert body). */
	capCert: 'harborage/sig/cap-cert/v1',
	/** Per-request proof of possession bound to one cap-cert. */
	pop: 'harborage/sig/pop/v1',
	/** A corroboration cast on an item. */
	corroboration: 'harborage/sig/corroboration/v1',
	/** A report-a-problem on a directory entry. */
	directoryReport: 'harborage/sig/directory-report/v1',
	/** A brokered aid request card, sealed to a counterparty one-shot prekey. */
	aidRequest: 'harborage/sig/aid-request/v1',
	/** A responder's acceptance of an open need. */
	aidAccept: 'harborage/sig/aid-accept/v1'
} as const;

export type SigContext = (typeof SIG_CONTEXT)[keyof typeof SIG_CONTEXT];

const MAX_CONTEXT_BYTES = 255;

/**
 * Frame `message` under `context` as `u8(len) ‖ utf8(context) ‖ message`.
 *
 * The length byte is what makes the tag set prefix-free. With a bare prefix,
 * a context of "a" and a message of "b/c…" is byte-identical to a context of
 * "a/b" and a message of "c…", which would defeat the whole point.
 */
export function domainSeparate(context: SigContext, message: Uint8Array): Uint8Array {
	const tag = new TextEncoder().encode(context);
	if (tag.length === 0 || tag.length > MAX_CONTEXT_BYTES)
		throw new Error('signing context must be 1..255 bytes');
	const out = new Uint8Array(1 + tag.length + message.length);
	out[0] = tag.length;
	out.set(tag, 1);
	out.set(message, 1 + tag.length);
	return out;
}
