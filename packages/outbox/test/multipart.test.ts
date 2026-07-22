import { describe, expect, it } from 'vitest';
import { fullJitterDelay, MAX_BACKOFF_MS } from '../src/backoff.ts';
import { MultipartUploader } from '../src/multipart.ts';
import {
	concurrencyFor,
	PART_SIZE,
	TransportError,
	type CipherSource,
	type MultipartCursor,
	type OutboxItem,
	type OutboxStore,
	type PartTransport,
	type PresignClient
} from '../src/types.ts';

function makeItem(size: number): OutboxItem {
	return {
		id: 'item-1',
		state: 'registered',
		derivative: { sha256: 'd'.repeat(64), size: 200_000, mime: 'image/webp', uploaded: true },
		original: { sha256: 'o'.repeat(64), size, mime: 'image/jpeg' },
		originalStatus: 'on_device_only',
		attempts: 0,
		nextEarliestRetry: 0,
		createdAt: 1,
		maxAge: 30 * 86_400_000
	};
}

function makeCipher(size: number): CipherSource {
	return {
		size,
		slice: async (start, end) => new Uint8Array(end - start).fill(7)
	};
}

class MemoryStore implements OutboxStore {
	items = new Map<string, OutboxItem>();
	putCount = 0;
	async get(id: string) {
		return this.items.get(id);
	}
	async put(item: OutboxItem) {
		this.putCount++;
		this.items.set(item.id, structuredClone(item));
	}
	async delete(id: string) {
		this.items.delete(id);
	}
	async list() {
		return [...this.items.values()];
	}
	async wipeAll() {
		this.items.clear();
	}
}

interface FakeOptions {
	failPart?: (n: number, attempt: number) => TransportError | null;
	failComplete?: TransportError | null;
	objectExists?: boolean;
}

function makeFakes(opts: FakeOptions = {}) {
	const partAttempts = new Map<number, number>();
	const presignCalls: number[] = [];
	let completed = 0;
	let aborted = 0;
	const presign: PresignClient = {
		createMultipart: async () => ({ key: 'ulid-key', uploadId: 'upload-1' }),
		presignPart: async (_c: MultipartCursor, n: number) => {
			presignCalls.push(n);
			return `https://r2/part/${n}`;
		},
		completeMultipart: async () => {
			if (opts.failComplete) {
				const err = opts.failComplete;
				opts.failComplete = null;
				throw err;
			}
			completed++;
		},
		abortMultipart: async () => {
			aborted++;
		},
		headObject: async () => opts.objectExists ?? false
	};
	const transport: PartTransport = {
		putPart: async (url: string) => {
			const n = Number(url.split('/').pop());
			const attempt = (partAttempts.get(n) ?? 0) + 1;
			partAttempts.set(n, attempt);
			const err = opts.failPart?.(n, attempt);
			if (err) throw err;
			return { etag: `etag-${n}` };
		}
	};
	return {
		presign,
		transport,
		presignCalls,
		stats: () => ({ completed, aborted })
	};
}

describe('multipart engine', () => {
	it('uploads all parts, persists each ETag before advancing, then vaults', async () => {
		const size = PART_SIZE * 2 + 1000; // 3 parts
		const store = new MemoryStore();
		const fakes = makeFakes();
		const up = new MultipartUploader(store, fakes.presign, fakes.transport);
		const result = await up.step(makeItem(size), makeCipher(size));

		expect(result.outcome).toBe('done');
		expect(result.item.originalStatus).toBe('vaulted');
		expect(result.item.original.r2?.parts.map((p) => p.etag)).toEqual([
			'etag-1',
			'etag-2',
			'etag-3'
		]);
		// Persisted at least: cursor create + 3 parts + completing + done.
		expect(store.putCount).toBeGreaterThanOrEqual(6);
	});

	it('resumes from the persisted cursor after a mid-upload kill', async () => {
		const size = PART_SIZE * 3; // 3 parts
		const store = new MemoryStore();
		const killer = makeFakes({
			failPart: (n) => (n === 2 ? new TransportError('retryable', 'network drop') : null)
		});
		const up1 = new MultipartUploader(store, killer.presign, killer.transport);
		const first = await up1.step(makeItem(size), makeCipher(size));
		expect(first.outcome).toBe('retry_later');
		expect(first.item.original.r2?.nextPart).toBe(2); // part 1 done, part 2 not
		expect(first.item.originalStatus).toBe('vaulting');

		// "New session": fresh uploader, same store, no failures. Resumes at 2.
		const clean = makeFakes();
		const up2 = new MultipartUploader(store, clean.presign, clean.transport);
		const persisted = (await store.get('item-1'))!;
		const resumed = await up2.step(persisted, makeCipher(size));
		expect(resumed.outcome).toBe('done');
		expect(clean.presignCalls[0]).toBe(2); // did not re-send part 1
		expect(resumed.item.originalStatus).toBe('vaulted');
	});

	it('re-mints transparently on an expired presigned URL', async () => {
		const size = PART_SIZE;
		const store = new MemoryStore();
		const fakes = makeFakes({
			failPart: (n, attempt) =>
				n === 1 && attempt === 1 ? new TransportError('expired', '403') : null
		});
		const up = new MultipartUploader(store, fakes.presign, fakes.transport);
		const result = await up.step(makeItem(size), makeCipher(size));
		expect(result.outcome).toBe('done');
		// presigned twice for part 1: original + re-mint.
		expect(fakes.presignCalls).toEqual([1, 1]);
	});

	it('restarts the multipart when the upload aged out and no object exists', async () => {
		const size = PART_SIZE;
		const store = new MemoryStore();
		const fakes = makeFakes({
			failComplete: new TransportError('no_such_upload'),
			objectExists: false
		});
		const up = new MultipartUploader(store, fakes.presign, fakes.transport);
		const result = await up.step(makeItem(size), makeCipher(size));
		expect(result.outcome).toBe('retry_later');
		expect(result.item.original.r2).toBeUndefined();
		expect(result.item.originalStatus).toBe('on_device_only');
	});

	it('treats no_such_upload on complete as success when a HEAD confirms the object', async () => {
		const size = PART_SIZE;
		const store = new MemoryStore();
		const fakes = makeFakes({
			failComplete: new TransportError('no_such_upload'),
			objectExists: true
		});
		const up = new MultipartUploader(store, fakes.presign, fakes.transport);
		const result = await up.step(makeItem(size), makeCipher(size));
		expect(result.outcome).toBe('done');
		expect(result.item.originalStatus).toBe('vaulted');
	});

	it('aborts the upload on invalid_part (local bug) but keeps the item', async () => {
		const size = PART_SIZE;
		const store = new MemoryStore();
		const fakes = makeFakes({
			failPart: () => new TransportError('invalid_part')
		});
		const up = new MultipartUploader(store, fakes.presign, fakes.transport);
		const result = await up.step(makeItem(size), makeCipher(size));
		expect(result.outcome).toBe('aborted');
		expect(fakes.stats().aborted).toBe(1);
		expect(result.item.originalStatus).toBe('on_device_only');
		expect(await store.get('item-1')).toBeDefined();
	});

	it('cancel aborts remotely and deletes the row', async () => {
		const size = PART_SIZE * 2;
		const store = new MemoryStore();
		const killer = makeFakes({
			failPart: (n) => (n === 2 ? new TransportError('retryable') : null)
		});
		const up = new MultipartUploader(store, killer.presign, killer.transport);
		const partial = await up.step(makeItem(size), makeCipher(size));
		await up.cancel(partial.item);
		expect(killer.stats().aborted).toBe(1);
		expect(await store.get('item-1')).toBeUndefined();
	});
});

describe('backoff and concurrency', () => {
	it('full jitter stays within [0, min(60s, 2^attempt s))', () => {
		expect(fullJitterDelay(0, () => 0.999)).toBeLessThan(1000);
		expect(fullJitterDelay(3, () => 0.999)).toBeLessThan(8000);
		expect(fullJitterDelay(20, () => 0.999)).toBeLessThan(MAX_BACKOFF_MS);
		expect(fullJitterDelay(5, () => 0)).toBe(0);
	});

	it('is serial on slow links', () => {
		expect(concurrencyFor('slow')).toBe(1);
		expect(concurrencyFor('medium')).toBe(2);
		expect(concurrencyFor('fast')).toBe(3);
	});
});
