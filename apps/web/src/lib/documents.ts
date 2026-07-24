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
	/** Set once the record has been sent off device (only possible when document_intake is on). */
	sent?: boolean;
	derivative?: Derivative;
	original?: SealedOriginal;
}

// DELIBERATELY NOT RENAMED alongside "record" -> "report". These are on-device
// IndexedDB identifiers, invisible to users. Renaming them would orphan whatever
// is already stored on someone's phone, and what is stored here is the sealed
// pristine original of something they photographed — the one copy that may not
// exist anywhere else. An internal name is not worth that risk. A migration can
// rename them later if there is ever a reason.
const DB_NAME = 'harborage-records';
const STORE = 'records';

class LocalDocumentStore {
	private db: Promise<IDBPDatabase> | null = null;

	/** Lazy open: never touches indexedDB during SSR/prerender (browser only). */
	private open(): Promise<IDBPDatabase> {
		if (!this.db) {
			this.db = openDB(DB_NAME, 1, {
				upgrade(db) {
					db.createObjectStore(STORE, { keyPath: 'id' });
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

	/** Panic-wipe: destroy every on-device record. Irreversible. */
	async wipeAll(): Promise<void> {
		await (await this.open()).clear(STORE);
	}
}

export const documents = new LocalDocumentStore();

export function newId(): string {
	return crypto.randomUUID();
}
