/**
 * Keep-on-phone report store (PRD §4.4). Reports live in IndexedDB on THIS
 * device only — nothing here contacts the network. The pristine original
 * is sealed before it is stored (§7.5 seal-before-persist); the on-device content
 * key sits beside the ciphertext, so device seizure with an unlocked phone can
 * still read it (stated in /limits — best-effort until the APK). The redacted
 * derivative is the only copy that would ever leave the phone, and only when the
 * user later chooses to send AND document_intake is on.
 */
import { openDB, type IDBPDatabase } from 'idb';
import type { OriginalStatus } from '@harborage/outbox/types';
import type { IncidentType } from '$lib/incident-types';

export type DocumentKind = 'photo' | 'note' | 'audio';

/** The sealed pristine original + its on-device content key. */
export interface SealedOriginal {
	sha256: string;
	mime: string;
	sealed: Blob; // concatenated part-aligned ciphertext (ready to vault later)
	key: Uint8Array; // on-device only; never uploaded
}

/** The redacted, downscaled public copy (photo only). */
export interface Derivative {
	sha256: string;
	mime: string;
	blob: Blob;
}

export interface LocalDocument {
	id: string;
	kind: DocumentKind;
	type?: IncidentType;
	note?: string;
	area?: string; // coarse area the user typed; never GPS
	occurredDate?: string; // YYYY-MM-DD
	sourceLink?: string; // canonical content id for an imported clip (no server fetch yet)
	createdAt: number; // device clock; stays on device
	/** True only after the user confirmed faces/IDs are hidden. False => vault-only. */
	redactionConfirmed: boolean;
	/**
	 * Digest of the exact derivative bytes the human approved on the confirm
	 * screen (ARCHITECTURE §19:1216).
	 *
	 * A regression guard, not a second source of truth. The pixels confirmed and
	 * the pixels stored are one object by construction — there is no re-render
	 * between the two — and this records which bytes those were so that if a
	 * future refactor ever reintroduces a second render path, `save()` refuses
	 * rather than shipping something nobody reviewed.
	 */
	confirmedDerivativeSha?: string;
	/** Set once the record has been sent off device (only possible when document_intake is on). */
	sent?: boolean;
	/**
	 * Custody of the pristine original (ARCHITECTURE §19:1266-1268).
	 *
	 * Lives on the document rather than only on the queue row because the row is
	 * deleted once the upload completes, while the custody chain and any export
	 * still need to know whether the vault actually holds these bytes. A document
	 * is never presented as evidence-backed until this reads `vaulted`.
	 *
	 * Optional, and absent on records written before this field existed. No
	 * DB_VERSION bump: the stores are schemaless and adding a field is additive,
	 * whereas touching the upgrade path risks a sealed original that exists
	 * nowhere else.
	 */
	originalStatus?: OriginalStatus;
	derivative?: Derivative;
	original?: SealedOriginal;
}

/**
 * Crash-quarantine copy of a capture in flight (ARCHITECTURE §19:1212).
 *
 * A potato phone dying mid-redaction must not lose the evidence. Written
 * ENCRYPTED — the same sealed ciphertext that will later become the vault
 * artifact, so the original is sealed exactly once rather than twice on the
 * weakest device we support. Cleared at commit, and on the next open, so a
 * crashed capture is offered back once and does not linger.
 *
 * Honest limit, identical to the one above for `SealedOriginal`: the content key
 * sits beside the ciphertext, so a seized unlocked phone can still read it. That
 * is stated on /limits and is best-effort until the APK.
 */
export interface QuarantinedCapture {
	id: string;
	kind: DocumentKind;
	mime: string;
	sha256: string;
	sealed: Blob;
	key: Uint8Array;
	createdAt: number;
}

// DELIBERATELY NOT RENAMED alongside "record" -> "report". These are on-device
// IndexedDB identifiers, invisible to users. Renaming them would orphan whatever
// is already stored on someone's phone, and what is stored here is the sealed
// pristine original of something they photographed — the one copy that may not
// exist anywhere else. An internal name is not worth that risk. A migration can
// rename them later if there is ever a reason.
const DB_NAME = 'harborage-records';
const STORE = 'records';
const QUARANTINE = 'capture-quarantine';
/** v2 adds the crash-quarantine store. The upgrade is additive: nothing is dropped. */
const DB_VERSION = 2;

class LocalDocumentStore {
	private db: Promise<IDBPDatabase> | null = null;

	/** Lazy open: never touches indexedDB during SSR/prerender (browser only). */
	private open(): Promise<IDBPDatabase> {
		if (!this.db) {
			this.db = openDB(DB_NAME, DB_VERSION, {
				upgrade(db, oldVersion) {
					// Guarded by oldVersion rather than unconditional creates: an
					// existing phone holds the sealed pristine original of something
					// that may exist nowhere else, and re-creating a store would
					// destroy it.
					if (oldVersion < 1) db.createObjectStore(STORE, { keyPath: 'id' });
					if (oldVersion < 2) db.createObjectStore(QUARANTINE, { keyPath: 'id' });
				}
			});
		}
		return this.db;
	}

	async put(rec: LocalDocument): Promise<void> {
		await (await this.open()).put(STORE, rec);
	}

	async get(id: string): Promise<LocalDocument | undefined> {
		return (await this.open()).get(STORE, id) as Promise<LocalDocument | undefined>;
	}

	async list(): Promise<LocalDocument[]> {
		const all = (await (await this.open()).getAll(STORE)) as LocalDocument[];
		return all.sort((a, b) => b.createdAt - a.createdAt);
	}

	async delete(id: string): Promise<void> {
		await (await this.open()).delete(STORE, id);
	}

	/** Hold a sealed capture while the human works on the cover boxes. */
	async quarantine(entry: QuarantinedCapture): Promise<void> {
		await (await this.open()).put(QUARANTINE, entry);
	}

	async quarantined(): Promise<QuarantinedCapture[]> {
		const all = (await (await this.open()).getAll(QUARANTINE)) as QuarantinedCapture[];
		return all.sort((a, b) => b.createdAt - a.createdAt);
	}

	async releaseQuarantine(id: string): Promise<void> {
		await (await this.open()).delete(QUARANTINE, id);
	}

	/** Device erase: destroy every on-device document AND every quarantined capture. */
	async wipeAll(): Promise<void> {
		const db = await this.open();
		await Promise.all([db.clear(STORE), db.clear(QUARANTINE)]);
	}

	/**
	 * Release the connection. `indexedDB.deleteDatabase` blocks silently while
	 * any connection is open, so the erase clears the stores and then quietly
	 * fails to remove the database without this. Dropping the cached handle
	 * means a later call reopens rather than reusing a closed one.
	 */
	async close(): Promise<void> {
		const pending = this.db;
		this.db = null;
		if (pending) (await pending).close();
	}
}

export const documents = new LocalDocumentStore();

export function newId(): string {
	return crypto.randomUUID();
}
