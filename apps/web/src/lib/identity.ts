/**
 * On-device identity custody (PRD §4.3; ARCHITECTURE §5.1–5.2).
 *
 * This is the fourth IndexedDB in the app and the only one holding key
 * material. It owns storage and lifecycle; every cryptographic operation lives
 * in @harborage/crypto/device-keys, per the frozen-module rule.
 *
 * What is stored, and what deliberately is not:
 *
 *   root       non-extractable HKDF CryptoKey. Cannot be read back out, by us
 *              or by injected script. Everything else derives from it.
 *   keys       non-extractable Ed25519/X25519 (or P-256) CryptoKeys, cached per
 *              compartment and epoch. Re-derivable, so losing them is harmless.
 *   meta       tier, per-compartment epochs, backup state, public keys.
 *   words      the backup phrase. Present ONLY while backup is pending, or
 *              while the user has explicitly chosen to keep it here. Erased
 *              otherwise, and never re-derivable from anything above.
 *
 * There is no account row, no session, no server call, and no recovery path.
 * "Lose the backup words and you lose the account" is not a limitation we
 * failed to fix; the absence of a reset is what makes the account impossible
 * to compel out of us.
 *
 * HONEST LIMIT (ARCHITECTURE §9.7, surfaced at /limits): non-extractable is not
 * hardware-backed, and IndexedDB is not encrypted at rest. A seized, unlocked
 * phone can still USE these keys. What the design removes is the ability to
 * copy the key material off the device or exfiltrate it through an injected
 * script. That is real and it is not the same as safety. The APK is the fix.
 */
import { openDB, type IDBPDatabase } from 'idb';
import { isValidMnemonic, mnemonicToRootSeed, newMnemonic } from '@harborage/crypto/mnemonic';
import {
	ACTIVE_COMPARTMENTS,
	FIRST_EPOCH,
	isValidEpoch,
	nextEpoch,
	type Compartment,
	type SigContext,
	type SigningAlgId
} from '@harborage/crypto/compartments';
import {
	detectCustodyTier,
	deriveCompartmentSeed,
	importBoxKey,
	importRootKey,
	importSigningKey,
	signWithDeviceKey,
	zero,
	type CustodyTier,
	type DeviceSigningKey
} from '@harborage/crypto/device-keys';
import {
	BACKUP_WORD_COUNT,
	CONFIRM_WORD_COUNT,
	checkConfirmAnswers,
	fingerprint,
	mnemonicWords,
	normalizeMnemonic,
	pickConfirmPositions,
	tierCanSign,
	type BackupState
} from '$lib/identity-core';

const DB_NAME = 'harborage-identity';
const STORE_KEYS = 'keys';
const STORE_META = 'meta';
const META_KEY = 'meta';
const ROOT_KEY = 'root';
const WORDS_KEY = 'words';

interface IdentityMeta {
	tier: CustodyTier;
	/** Device-local, monotonic, per compartment. Never a server value. */
	epochs: Partial<Record<Compartment, number>>;
	backup: BackupState;
	/** Public halves only. Safe to hold, and what the fingerprint is drawn from. */
	publicKeys: Partial<Record<Compartment, string>>;
}

export interface IdentityState {
	exists: boolean;
	tier: CustodyTier;
	canSign: boolean;
	backup: BackupState;
	/** Short, human-comparable form of the document-compartment public key. */
	fingerprint: string | null;
}

export interface CreatedIdentity {
	words: string[];
	/** Positions the user must re-type to confirm. Ascending. */
	confirmPositions: number[];
}

let dbP: Promise<IDBPDatabase> | null = null;

/** Lazy open: every route is prerendered, so this must never run at module scope. */
function db(): Promise<IDBPDatabase> {
	if (!dbP) {
		dbP = openDB(DB_NAME, 1, {
			upgrade(d) {
				d.createObjectStore(STORE_KEYS);
				d.createObjectStore(STORE_META);
			}
		});
	}
	return dbP;
}

/**
 * Unlike the notices cache, a failure here is a correctness failure, not a
 * cache miss. Swallowing it would leave a user believing they have an account
 * that does not exist, so it surfaces.
 */
export class IdentityStorageError extends Error {
	constructor(cause: unknown) {
		super('identity storage unavailable');
		this.cause = cause;
	}
}

async function readMeta(): Promise<IdentityMeta | undefined> {
	try {
		return (await (await db()).get(STORE_META, META_KEY)) as IdentityMeta | undefined;
	} catch (e) {
		throw new IdentityStorageError(e);
	}
}

async function writeMeta(meta: IdentityMeta): Promise<void> {
	try {
		await (await db()).put(STORE_META, meta, META_KEY);
	} catch (e) {
		throw new IdentityStorageError(e);
	}
}

function hex(bytes: Uint8Array): string {
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function unhex(s: string): Uint8Array {
	const out = new Uint8Array(s.length / 2);
	for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(s.slice(i * 2, i * 2 + 2), 16);
	return out;
}

function keyId(compartment: Compartment, epoch: number, use: 'sign' | 'box'): string {
	return `${compartment}/${epoch}/${use}`;
}

// --- Read -------------------------------------------------------------------

export async function getState(): Promise<IdentityState> {
	const meta = await readMeta();
	if (!meta) {
		// Report the tier even with no identity, so the read-only case can be
		// explained before the user tries to create one and fails.
		const tier = await detectCustodyTier();
		return { exists: false, tier, canSign: tierCanSign(tier), backup: 'erased', fingerprint: null };
	}
	const pub = meta.publicKeys.document;
	return {
		exists: true,
		tier: meta.tier,
		canSign: tierCanSign(meta.tier),
		backup: meta.backup,
		fingerprint: pub ? fingerprint(unhex(pub)) : null
	};
}

/** The backup phrase, if it is still on this device. Null once erased. */
export async function readWords(): Promise<string[] | null> {
	try {
		const words = (await (await db()).get(STORE_META, WORDS_KEY)) as string | undefined;
		return words ? mnemonicWords(words) : null;
	} catch (e) {
		throw new IdentityStorageError(e);
	}
}

// --- Create / restore -------------------------------------------------------

function randomBelow(exclusiveMax: number): number {
	if (exclusiveMax <= 0) return 0;
	// Rejection-sample so the modulo does not skew which words get asked for.
	const limit = Math.floor(0xffffffff / exclusiveMax) * exclusiveMax;
	const buf = new Uint32Array(1);
	let v = 0;
	do {
		crypto.getRandomValues(buf);
		v = buf[0] ?? 0;
	} while (v >= limit);
	return v % exclusiveMax;
}

async function installTree(phrase: string, tier: CustodyTier): Promise<IdentityMeta> {
	const seed = await mnemonicToRootSeed(phrase);
	let root: CryptoKey;
	try {
		root = await importRootKey(seed);
	} finally {
		// The seed exists as bytes for exactly as long as the import takes.
		zero(seed);
	}

	const meta: IdentityMeta = { tier, epochs: {}, backup: 'pending', publicKeys: {} };
	const store = await db();
	await store.put(STORE_KEYS, root, ROOT_KEY);

	// Derive every active compartment now, so a later send never has to reach
	// for the root while the user is standing somewhere they need to leave.
	for (const compartment of ACTIVE_COMPARTMENTS) {
		const epoch = FIRST_EPOCH;
		const compartmentSeed = await deriveCompartmentSeed(root, compartment, epoch);
		try {
			const signing = await importSigningKey(compartmentSeed, tier);
			const box = await importBoxKey(compartmentSeed, tier);
			await store.put(STORE_KEYS, signing, keyId(compartment, epoch, 'sign'));
			await store.put(STORE_KEYS, box, keyId(compartment, epoch, 'box'));
			meta.epochs[compartment] = epoch;
			meta.publicKeys[compartment] = hex(signing.publicKey);
		} finally {
			zero(compartmentSeed);
		}
	}
	return meta;
}

/**
 * Make an identity on this device. Returns the words to show once, plus the
 * positions to confirm. Nothing is sent anywhere; there is nothing to send.
 */
export async function create(): Promise<CreatedIdentity> {
	const tier = await detectCustodyTier();
	if (!tierCanSign(tier)) throw new Error('this device cannot hold an account');

	const phrase = newMnemonic();
	const meta = await installTree(phrase, tier);
	try {
		await (await db()).put(STORE_META, phrase, WORDS_KEY);
		await writeMeta(meta);
	} catch (e) {
		throw new IdentityStorageError(e);
	}
	const words = mnemonicWords(phrase);
	return {
		words,
		confirmPositions: pickConfirmPositions(words.length, CONFIRM_WORD_COUNT, randomBelow)
	};
}

/**
 * Silent creation at first send (PRD §15 flow B: "The on-device key is made
 * silently here, in one plain line"). Leaves backup pending, which is what puts
 * the write-these-down prompt in front of the user afterwards rather than
 * before they have done the thing they came to do.
 */
export async function ensure(): Promise<IdentityState> {
	const existing = await getState();
	if (existing.exists) return existing;
	await create();
	return getState();
}

export function wordsAreValid(phrase: string): boolean {
	const normalized = normalizeMnemonic(phrase);
	return mnemonicWords(normalized).length === BACKUP_WORD_COUNT && isValidMnemonic(normalized);
}

/**
 * Rebuild the tree from a phrase the user already holds. Backup starts
 * `erased`: they demonstrably have the words elsewhere, so holding a second
 * copy here would add exposure and buy nothing.
 */
export async function restore(phrase: string, keepWords = false): Promise<void> {
	const normalized = normalizeMnemonic(phrase);
	if (!wordsAreValid(normalized)) throw new Error('those are not valid backup words');
	const tier = await detectCustodyTier();
	if (!tierCanSign(tier)) throw new Error('this device cannot hold an account');

	const meta = await installTree(normalized, tier);
	meta.backup = keepWords ? 'kept' : 'erased';
	try {
		const store = await db();
		if (keepWords) await store.put(STORE_META, normalized, WORDS_KEY);
		else await store.delete(STORE_META, WORDS_KEY);
		await writeMeta(meta);
	} catch (e) {
		throw new IdentityStorageError(e);
	}
}

// --- Backup lifecycle -------------------------------------------------------

export async function confirmBackup(
	positions: readonly number[],
	answers: readonly string[],
	keepWords: boolean
): Promise<boolean> {
	const words = await readWords();
	if (!words) return false;
	if (!checkConfirmAnswers(words, positions, answers)) return false;

	const meta = await readMeta();
	if (!meta) return false;
	meta.backup = keepWords ? 'kept' : 'erased';
	try {
		if (!keepWords) await (await db()).delete(STORE_META, WORDS_KEY);
		await writeMeta(meta);
	} catch (e) {
		throw new IdentityStorageError(e);
	}
	return true;
}

/**
 * Turning this off erases the words and cannot be undone from here — the only
 * way back is to restore from the paper copy. Turning it on is only possible
 * while the words still exist, which the page enforces before calling.
 */
export async function setKeepWords(keep: boolean): Promise<void> {
	const meta = await readMeta();
	if (!meta) return;
	if (keep) {
		const words = await readWords();
		if (!words) throw new Error('the backup words are no longer on this phone');
		meta.backup = 'kept';
	} else {
		try {
			await (await db()).delete(STORE_META, WORDS_KEY);
		} catch (e) {
			throw new IdentityStorageError(e);
		}
		meta.backup = 'erased';
	}
	await writeMeta(meta);
}

// --- Use --------------------------------------------------------------------

export async function publicKeyFor(compartment: Compartment): Promise<Uint8Array | null> {
	const meta = await readMeta();
	const pub = meta?.publicKeys[compartment];
	return pub ? unhex(pub) : null;
}

/**
 * Which signature algorithm this device's key uses. A verifier must be told
 * rather than guessing from a length, so it travels in the cap-cert.
 */
export async function signingAlgFor(compartment: Compartment): Promise<SigningAlgId | null> {
	const meta = await readMeta();
	if (!meta) return null;
	const epoch = meta.epochs[compartment];
	if (epoch === undefined) return null;
	const key = (await (await db()).get(STORE_KEYS, keyId(compartment, epoch, 'sign'))) as
		| DeviceSigningKey
		| undefined;
	return key?.algId ?? null;
}

/**
 * Sign under a compartment identity and a domain-separation context. The
 * private key never leaves IndexedDB as bytes; WebCrypto uses it in place.
 */
export async function sign(
	compartment: Compartment,
	context: SigContext,
	message: Uint8Array
): Promise<Uint8Array> {
	const meta = await readMeta();
	if (!meta) throw new Error('no account on this device');
	const epoch = meta.epochs[compartment];
	if (epoch === undefined) throw new Error(`no key for ${compartment}`);
	const key = (await (await db()).get(STORE_KEYS, keyId(compartment, epoch, 'sign'))) as
		| DeviceSigningKey
		| undefined;
	if (!key) throw new Error(`no key for ${compartment}`);
	return signWithDeviceKey(key, context, message);
}

/**
 * Start fresh in one compartment: bump its device-local epoch and derive a new
 * key. The old key is dropped, so anything already published under it stays
 * published and simply stops being linkable to what comes next. Other
 * compartments are untouched, which is the entire point of having them.
 */
export async function rotateCompartment(compartment: Compartment): Promise<void> {
	const meta = await readMeta();
	if (!meta) throw new Error('no account on this device');
	const current = meta.epochs[compartment] ?? FIRST_EPOCH;
	const next = nextEpoch(current);
	if (next === null || !isValidEpoch(next)) throw new Error('cannot start fresh again');

	const store = await db();
	const root = (await store.get(STORE_KEYS, ROOT_KEY)) as CryptoKey | undefined;
	if (!root) throw new Error('no account on this device');

	const compartmentSeed = await deriveCompartmentSeed(root, compartment, next);
	try {
		const signing = await importSigningKey(compartmentSeed, meta.tier);
		const box = await importBoxKey(compartmentSeed, meta.tier);
		await store.put(STORE_KEYS, signing, keyId(compartment, next, 'sign'));
		await store.put(STORE_KEYS, box, keyId(compartment, next, 'box'));
		await store.delete(STORE_KEYS, keyId(compartment, current, 'sign'));
		await store.delete(STORE_KEYS, keyId(compartment, current, 'box'));
		meta.epochs[compartment] = next;
		meta.publicKeys[compartment] = hex(signing.publicKey);
	} finally {
		zero(compartmentSeed);
	}
	await writeMeta(meta);
}

/**
 * Remove the account from this phone. Irreversible without the backup words,
 * which is stated plainly at the confirm step rather than discovered after.
 * Deliberately scoped to identity: documents and the outbox have their own
 * wipes, and one button that silently destroys everything is how people lose
 * evidence they meant to keep.
 */
export async function wipe(): Promise<void> {
	try {
		const store = await db();
		await store.clear(STORE_KEYS);
		await store.clear(STORE_META);
	} catch (e) {
		throw new IdentityStorageError(e);
	}
}
