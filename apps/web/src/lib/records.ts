/**
 * Keep-on-phone record store (PRD §4.4, §15 Record). Records live in IndexedDB
 * on THIS device only — nothing here contacts the network. The pristine original
 * is sealed before it is stored (§7.5 seal-before-persist); the on-device content
 * key sits beside the ciphertext, so device seizure with an unlocked phone can
 * still read it (stated in /limits — best-effort until the APK). The redacted
 * derivative is the only copy that would ever leave the phone, and only when the
 * user later chooses to send AND record_intake is on.
 */
import { openDB, type IDBPDatabase } from 'idb';
import type { IncidentType } from '$lib/incident-types';

export type RecordKind = 'photo' | 'note' | 'audio';

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

export interface LocalRecord {
	id: string;
	kind: RecordKind;
	type?: IncidentType;
	note?: string;
	area?: string; // coarse area the user typed; never GPS
	occurredDate?: string; // YYYY-MM-DD
	sourceLink?: string; // canonical content id for an imported clip (no server fetch yet)
	createdAt: number; // device clock; stays on device
	/** True only after the user confirmed faces/IDs are hidden. False => vault-only. */
	redactionConfirmed: boolean;
	/** Set once the record has been sent off device (only possible when record_intake is on). */
	sent?: boolean;
	derivative?: Derivative;
	original?: SealedOriginal;
}

const DB_NAME = 'harborage-records';
const STORE = 'records';

class LocalRecordStore {
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

	async put(rec: LocalRecord): Promise<void> {
		await (await this.open()).put(STORE, rec);
	}

	async get(id: string): Promise<LocalRecord | undefined> {
		return (await this.open()).get(STORE, id) as Promise<LocalRecord | undefined>;
	}

	async list(): Promise<LocalRecord[]> {
		const all = (await (await this.open()).getAll(STORE)) as LocalRecord[];
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

export const records = new LocalRecordStore();

export function newId(): string {
	return crypto.randomUUID();
}
