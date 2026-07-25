/**
 * Evidence-vault content-key custody (ARCHITECTURE §5.4, Decision 6).
 *
 * A random 256-bit CEK per file encrypts the pristine original. This module
 * decides WHO can ever reassemble that CEK, and the whole point is that the
 * platform is not on the list: it holds zero shares and exposes no unwrap
 * endpoint, which is what makes "we cannot produce plaintext" literally true
 * and auditable rather than a promise.
 *
 * WHY THIS IS NOT JUST `shamir.ts`. §5.4 asks for "Shamir 2-of-3" and then, in
 * the same breath, for a property plain Shamir cannot express:
 *
 *   "no set of holders reachable within one jurisdiction may reach threshold.
 *    The offshore custodian's share is MANDATORY in every quorum."
 *
 * A plain 2-of-3 split over {reporter, lawyer, offshore} is satisfied by
 * {reporter, lawyer} — both reachable in one jurisdiction, offshore not
 * involved. That is precisely the compulsion this tier exists to defeat, so
 * implementing the literal sentence would have shipped a scheme that fails its
 * own stated requirement. Threshold cryptography has no notion of a mandatory
 * participant; you get it by construction instead:
 *
 *   CEK = K_offshore XOR K_domestic
 *
 * `K_offshore` goes only to the offshore custodian. `K_domestic` goes to the
 * domestic holders (directly at t=1, Shamir-split at t>=2). Reconstruction
 * therefore needs the offshore half PLUS a domestic quorum — "offshore + one of
 * {reporter, lawyer}", exactly as §5.4 describes the intent. Seizing every
 * domestic holder yields `K_domestic`, which is an independent uniform random
 * value and reveals nothing about the CEK.
 *
 * FAIL-CLOSED. `PINNED_CUSTODIAN_KEYS` ships EMPTY, mirroring
 * `PINNED_PACK_PUBKEYS`. No custodian exists yet, so every wrap refuses. That is
 * the switch-on gate made structural: there is no configuration that produces a
 * keyring with no offshore holder.
 *
 * No ambient globals: randomness is passed in, so Workers and tests behave
 * identically and nothing here depends on a DOM.
 */
import { sealTo, EPK_LENGTH, NONCE_LENGTH } from './sealed-box.ts';
import { splitSecret } from './shamir.ts';

/** Content-encryption key length. Matches `newContentKey()`. */
export const CEK_LENGTH = 32;

/**
 * Who may hold key material. Closed set: a holder class carries a jurisdiction
 * assumption, and inventing a new one is a custody design change, not a config
 * change.
 */
export const HOLDERS = ['reporter', 'lawyer', 'custodian-offshore'] as const;
export type Holder = (typeof HOLDERS)[number];

/** Holders assumed reachable by the same authority as the platform. */
export const DOMESTIC_HOLDERS: readonly Holder[] = ['reporter', 'lawyer'];

export function isOffshore(holder: Holder): boolean {
	return holder === 'custodian-offshore';
}

export interface HolderKey {
	holder: Holder;
	/** X25519 public key the copy is sealed to. */
	publicKey: Uint8Array;
}

/**
 * Off-platform custodian keys, pinned at build time.
 *
 * EMPTY BY DESIGN. Populating this is a ceremony step that requires a custodian
 * organisation in another jurisdiction to exist and hold a key. Until then every
 * wrap below refuses, so no evidence original can be sealed under a custody
 * scheme that has nobody to honour it.
 */
export const PINNED_CUSTODIAN_KEYS: readonly HolderKey[] = [];

export type VaultTier = 'A' | 'B';

export interface WrappedCopy {
	holder: Holder;
	/** Anonymous sealed-box ciphertext to that holder's key. */
	sealed: Uint8Array;
}

/**
 * The keyring for one file. Opaque to the platform: every element is ciphertext
 * under a key held off-platform.
 */
export interface Keyring {
	version: 1;
	tier: VaultTier;
	/** SHA-256 of the pristine original. Binds this keyring to exactly one file. */
	originalSha256: Uint8Array;
	copies: WrappedCopy[];
}

export class VaultCustodyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'VaultCustodyError';
	}
}

/** Randomness port. Injected so this module has no ambient global. */
export interface Rng {
	(length: number): Uint8Array;
}

function xor(a: Uint8Array, b: Uint8Array): Uint8Array {
	if (a.length !== b.length) throw new VaultCustodyError('xor length mismatch');
	const out = new Uint8Array(a.length);
	for (let i = 0; i < a.length; i++) out[i] = a[i]! ^ b[i]!;
	return out;
}

function requireOffshore(custodians: readonly HolderKey[]): HolderKey {
	const offshore = custodians.filter((c) => isOffshore(c.holder));
	if (offshore.length === 0)
		throw new VaultCustodyError(
			'no offshore custodian key is pinned; refusing to wrap an evidence key that a single jurisdiction could compel'
		);
	return offshore[0]!;
}

function sealCopy(key: HolderKey, secret: Uint8Array, rng: Rng): WrappedCopy {
	const ephemeralSeed = rng(EPK_LENGTH);
	const nonce = rng(NONCE_LENGTH);
	try {
		return { holder: key.holder, sealed: sealTo(key.publicKey, secret, ephemeralSeed, nonce) };
	} finally {
		ephemeralSeed.fill(0);
	}
}

/**
 * Tier A (lower sensitivity): the CEK is sealed to the reporter's vault key AND
 * to one off-platform custodian. Two independent copies, neither on the
 * platform — the reporter can always open their own evidence, and losing the
 * phone is not the same as losing the evidence.
 */
export function wrapTierA(
	cek: Uint8Array,
	originalSha256: Uint8Array,
	reporter: HolderKey,
	rng: Rng,
	custodians: readonly HolderKey[] = PINNED_CUSTODIAN_KEYS
): Keyring {
	if (cek.length !== CEK_LENGTH) throw new VaultCustodyError('bad content key length');
	if (originalSha256.length !== 32) throw new VaultCustodyError('bad original digest length');
	if (reporter.holder !== 'reporter') throw new VaultCustodyError('first holder must be reporter');
	const offshore = requireOffshore(custodians);
	return {
		version: 1,
		tier: 'A',
		originalSha256,
		copies: [sealCopy(reporter, cek, rng), sealCopy(offshore, cek, rng)]
	};
}

/**
 * Tier B (sealed / detainee-linked): the offshore half is mandatory.
 *
 * `domesticThreshold` is how many domestic holders must cooperate ALONGSIDE the
 * offshore custodian. Counsel sets it (§5.4). At 1 the domestic half is sealed
 * to each domestic holder directly — Shamir with a threshold of 1 is a
 * degenerate split that hands every holder the whole secret while looking like
 * a threshold scheme, so it is not used to dress up a plain copy.
 */
export async function wrapTierB(
	cek: Uint8Array,
	originalSha256: Uint8Array,
	domestic: readonly HolderKey[],
	rng: Rng,
	domesticThreshold = 1,
	custodians: readonly HolderKey[] = PINNED_CUSTODIAN_KEYS
): Promise<Keyring> {
	if (cek.length !== CEK_LENGTH) throw new VaultCustodyError('bad content key length');
	if (originalSha256.length !== 32) throw new VaultCustodyError('bad original digest length');
	if (domestic.length === 0) throw new VaultCustodyError('tier B needs at least one domestic holder');
	if (domestic.some((d) => isOffshore(d.holder)))
		throw new VaultCustodyError('the offshore custodian is not a domestic holder');
	if (domesticThreshold < 1 || domesticThreshold > domestic.length)
		throw new VaultCustodyError('domestic threshold out of range');
	const offshore = requireOffshore(custodians);

	// Split first, so neither half alone is the key. K_domestic is uniform
	// random and independent of the CEK: compelling every domestic holder yields
	// a value that reveals nothing.
	const kOffshore = rng(CEK_LENGTH);
	const kDomestic = xor(cek, kOffshore);

	const copies: WrappedCopy[] = [sealCopy(offshore, kOffshore, rng)];
	if (domesticThreshold === 1) {
		for (const holder of domestic) copies.push(sealCopy(holder, kDomestic, rng));
	} else {
		const shares = await splitSecret(kDomestic, domestic.length, domesticThreshold);
		domestic.forEach((holder, i) => copies.push(sealCopy(holder, shares[i]!, rng)));
	}
	kOffshore.fill(0);
	kDomestic.fill(0);
	return { version: 1, tier: 'B', originalSha256, copies };
}

/**
 * Reassemble a Tier B CEK from an offshore half and a domestic half.
 *
 * Present so the construction is testable and so the recovery procedure is
 * written down in code rather than only in a runbook. It takes already-opened
 * halves: opening a copy needs a holder's private key, which by construction
 * never exists on the platform, so there is deliberately no function here that
 * takes a keyring and returns a CEK.
 */
export function combineTierB(kOffshore: Uint8Array, kDomestic: Uint8Array): Uint8Array {
	return xor(kOffshore, kDomestic);
}

// --- Wire encoding -----------------------------------------------------------
//
// version(1) || tier(1) || originalSha256(32) || copyCount(1)
//   then per copy: holderOrdinal(1) || len(2 BE) || sealed
//
// Deliberately carries no identity, no timestamp, and no file name: the platform
// stores this blob and must learn nothing from it beyond "a keyring exists for
// this original digest".

const MAX_COPIES = 8;

export function encodeKeyring(k: Keyring): Uint8Array {
	if (k.copies.length === 0 || k.copies.length > MAX_COPIES)
		throw new VaultCustodyError('bad copy count');
	let size = 1 + 1 + 32 + 1;
	for (const c of k.copies) size += 1 + 2 + c.sealed.length;
	const out = new Uint8Array(size);
	out[0] = k.version;
	out[1] = k.tier === 'A' ? 1 : 2;
	out.set(k.originalSha256, 2);
	out[34] = k.copies.length;
	let at = 35;
	for (const c of k.copies) {
		out[at] = HOLDERS.indexOf(c.holder);
		out[at + 1] = (c.sealed.length >> 8) & 0xff;
		out[at + 2] = c.sealed.length & 0xff;
		out.set(c.sealed, at + 3);
		at += 3 + c.sealed.length;
	}
	return out;
}

/** Null on anything malformed: a stored blob is untrusted input, never a throw. */
export function decodeKeyring(buf: Uint8Array): Keyring | null {
	if (buf.length < 35) return null;
	if (buf[0] !== 1) return null;
	const tier: VaultTier | null = buf[1] === 1 ? 'A' : buf[1] === 2 ? 'B' : null;
	if (!tier) return null;
	const originalSha256 = buf.subarray(2, 34);
	const count = buf[34]!;
	if (count === 0 || count > MAX_COPIES) return null;
	const copies: WrappedCopy[] = [];
	let at = 35;
	for (let i = 0; i < count; i++) {
		if (at + 3 > buf.length) return null;
		const holder = HOLDERS[buf[at]!];
		if (!holder) return null;
		const len = (buf[at + 1]! << 8) | buf[at + 2]!;
		if (len === 0 || at + 3 + len > buf.length) return null;
		copies.push({ holder, sealed: buf.subarray(at + 3, at + 3 + len) });
		at += 3 + len;
	}
	if (at !== buf.length) return null;
	return { version: 1, tier, originalSha256, copies };
}

/**
 * Structural check that a keyring's custody topology is sound, independent of
 * who built it. Used by tests and available to a reviewer tool; the platform
 * never needs to open a copy to run it.
 */
export function quorumIsOffshoreBound(k: Keyring): boolean {
	const offshore = k.copies.filter((c) => isOffshore(c.holder));
	if (offshore.length !== 1) return false;
	if (k.tier === 'A') {
		// Tier A is two independent whole-key copies, so "offshore-bound" means
		// only that a custodian copy exists alongside the reporter's.
		return k.copies.some((c) => c.holder === 'reporter') && k.copies.length >= 2;
	}
	// Tier B: every other copy is a domestic half, useless without the offshore one.
	return k.copies.length >= 2 && k.copies.every((c) => isOffshore(c.holder) || DOMESTIC_HOLDERS.includes(c.holder));
}
