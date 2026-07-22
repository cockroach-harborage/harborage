/**
 * Resumable multipart engine (§19). Invariants:
 * - Fixed part size for the upload's life (R2 equal-size rule; may start on 2G
 *   and finish on Wi-Fi).
 * - Every part's ETag is persisted BEFORE nextPart advances, so a kill between
 *   part N and N+1 resumes at N+1 with nothing lost.
 * - `completing` is a distinct persisted state; CompleteMultipartUpload is
 *   idempotent: NoSuchUpload/already-completed counts as success only if a
 *   HEAD confirms the object, else the multipart restarts.
 * - `vaulted` flips ONLY after complete is confirmed.
 */
import type {
	CipherSource,
	MultipartCursor,
	OutboxItem,
	OutboxStore,
	PartTransport,
	PresignClient
} from './types.ts';
import { PART_SIZE, TransportError } from './types.ts';

export interface StepResult {
	item: OutboxItem;
	outcome: 'progress' | 'done' | 'retry_later' | 'aborted';
}

export class MultipartUploader {
	constructor(
		private store: OutboxStore,
		private presign: PresignClient,
		private transport: PartTransport
	) {}

	partCount(size: number): number {
		return Math.max(1, Math.ceil(size / PART_SIZE));
	}

	/**
	 * Drive one item as far as the link allows in this session. Persists after
	 * every state change; safe to kill at any await.
	 */
	async step(item: OutboxItem, cipher: CipherSource): Promise<StepResult> {
		if (item.state === 'done' || item.state === 'cancelled') {
			return { item, outcome: 'done' };
		}

		if (!item.original.r2) {
			const { key, uploadId } = await this.presign.createMultipart(item);
			item.original.r2 = {
				bucket: 'evidence-vault',
				key,
				uploadId,
				partSize: PART_SIZE,
				parts: [],
				nextPart: 1
			};
			item.state = 'uploading';
			item.originalStatus = 'vaulting';
			await this.store.put(item);
		}

		const cursor = item.original.r2;
		const total = this.partCount(cipher.size);

		try {
			while (cursor.nextPart <= total) {
				const n = cursor.nextPart;
				const start = (n - 1) * cursor.partSize;
				const end = Math.min(start + cursor.partSize, cipher.size);
				const bytes = await cipher.slice(start, end);
				const url = await this.presign.presignPart(cursor, n);
				const { etag } = await this.putPartWithRemint(url, bytes, cursor, n);
				// ETag persisted immediately, before nextPart advances (§19).
				cursor.parts.push({ n, etag });
				cursor.nextPart = n + 1;
				await this.store.put(item);
			}

			item.state = 'completing';
			await this.store.put(item);
			await this.completeIdempotent(item, cursor);
			return { item, outcome: 'done' };
		} catch (err) {
			return this.handleFailure(item, err);
		}
	}

	private async putPartWithRemint(
		url: string,
		bytes: Uint8Array,
		cursor: MultipartCursor,
		n: number
	): Promise<{ etag: string }> {
		try {
			return await this.transport.putPart(url, bytes);
		} catch (err) {
			if (err instanceof TransportError && err.kind === 'expired') {
				// Expected on 2G timescales: re-mint transparently, not a failure.
				const fresh = await this.presign.presignPart(cursor, n);
				return await this.transport.putPart(fresh, bytes);
			}
			throw err;
		}
	}

	private async completeIdempotent(item: OutboxItem, cursor: MultipartCursor): Promise<void> {
		try {
			await this.presign.completeMultipart(cursor);
		} catch (err) {
			if (err instanceof TransportError && err.kind === 'no_such_upload') {
				// Killed between complete and persist, or upload aged out. Only a
				// confirmed object counts as vaulted.
				const exists = await this.presign.headObject(cursor);
				if (!exists) {
					delete item.original.r2;
					item.state = 'registered';
					item.originalStatus = 'on_device_only';
					await this.store.put(item);
					throw new TransportError('retryable', 'multipart restarted');
				}
			} else {
				throw err;
			}
		}
		item.state = 'done';
		item.originalStatus = 'vaulted';
		await this.store.put(item);
	}

	private async handleFailure(item: OutboxItem, err: unknown): Promise<StepResult> {
		if (err instanceof TransportError) {
			if (err.kind === 'invalid_part') {
				// Local bug: abort this upload, keep the item and cipher for a
				// fresh multipart after investigation. Never silently drop.
				if (item.original.r2) await this.presign.abortMultipart(item.original.r2);
				delete item.original.r2;
				item.state = 'registered';
				item.originalStatus = 'on_device_only';
				item.attempts += 1;
				await this.store.put(item);
				return { item, outcome: 'aborted' };
			}
			if (err.kind === 'no_such_upload') {
				delete item.original.r2;
				item.state = 'registered';
				item.originalStatus = 'on_device_only';
				await this.store.put(item);
				return { item, outcome: 'retry_later' };
			}
		}
		item.attempts += 1;
		await this.store.put(item);
		return { item, outcome: 'retry_later' };
	}

	/** Best-effort cancel (§19): abort remotely, drop the row and cipher. */
	async cancel(item: OutboxItem): Promise<void> {
		if (item.original.r2) {
			try {
				await this.presign.abortMultipart(item.original.r2);
			} catch {
				// Remote abort is best-effort; R2's lifecycle rule collects strays.
			}
		}
		item.state = 'cancelled';
		await this.store.delete(item.id);
	}
}
