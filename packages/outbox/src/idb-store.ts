/**
 * IndexedDB adapter for the outbox (browser side). Rows hold sealed ciphertext
 * references only — plaintext never persists (§19, seal-before-enqueue).
 * Panic-wipe destroys rows and blobs; the UI states plainly that this destroys
 * any not-yet-vaulted original.
 */
import { openDB, type IDBPDatabase } from 'idb';
import type { OutboxItem, OutboxStore } from './types.ts';

const DB_NAME = 'harborage-outbox';
const STORE = 'items';
const BLOBS = 'cipher-blobs';

export class IdbOutboxStore implements OutboxStore {
	private db: Promise<IDBPDatabase>;

	constructor() {
		this.db = openDB(DB_NAME, 1, {
			upgrade(db) {
				db.createObjectStore(STORE, { keyPath: 'id' });
				db.createObjectStore(BLOBS);
			}
		});
	}

	async get(id: string): Promise<OutboxItem | undefined> {
		return (await this.db).get(STORE, id);
	}

	async put(item: OutboxItem): Promise<void> {
		await (await this.db).put(STORE, item);
	}

	async delete(id: string): Promise<void> {
		const db = await this.db;
		await db.delete(STORE, id);
		await db.delete(BLOBS, id);
	}

	async list(): Promise<OutboxItem[]> {
		return (await this.db).getAll(STORE);
	}

	async putCipherBlob(id: string, blob: Blob): Promise<void> {
		await (await this.db).put(BLOBS, blob, id);
	}

	async getCipherBlob(id: string): Promise<Blob | undefined> {
		return (await this.db).get(BLOBS, id);
	}

	async wipeAll(): Promise<void> {
		const db = await this.db;
		await db.clear(STORE);
		await db.clear(BLOBS);
	}
}
