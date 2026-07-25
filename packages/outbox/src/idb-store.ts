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
	private handle: Promise<IDBPDatabase> | null = null;

	/**
	 * Lazy open, like documents.ts and identity.ts. Every web route is
	 * prerendered, so touching `indexedDB` at construction would break the build
	 * the moment this is constructed anywhere but inside an event handler — and
	 * the outbox runner constructs it on mount.
	 */
	private open(): Promise<IDBPDatabase> {
		this.handle ??= openDB(DB_NAME, 1, {
			upgrade(db) {
				db.createObjectStore(STORE, { keyPath: 'id' });
				db.createObjectStore(BLOBS);
			}
		});
		return this.handle;
	}

	async get(id: string): Promise<OutboxItem | undefined> {
		return (await this.open()).get(STORE, id);
	}

	async put(item: OutboxItem): Promise<void> {
		await (await this.open()).put(STORE, item);
	}

	async delete(id: string): Promise<void> {
		const db = await this.open();
		await db.delete(STORE, id);
		await db.delete(BLOBS, id);
	}

	async list(): Promise<OutboxItem[]> {
		return (await this.open()).getAll(STORE);
	}

	async putCipherBlob(id: string, blob: Blob): Promise<void> {
		await (await this.open()).put(BLOBS, blob, id);
	}

	async getCipherBlob(id: string): Promise<Blob | undefined> {
		return (await this.open()).get(BLOBS, id);
	}

	async wipeAll(): Promise<void> {
		const db = await this.open();
		await db.clear(STORE);
		await db.clear(BLOBS);
	}

	/**
	 * Release the connection. `indexedDB.deleteDatabase` blocks silently while
	 * any connection is open, so the device-erase path cannot actually remove
	 * this database without it. Dropping the cached handle means a later call
	 * reopens rather than reusing a closed one.
	 */
	async close(): Promise<void> {
		const pending = this.handle;
		this.handle = null;
		if (pending) (await pending).close();
	}
}
