/**
 * Encrypted outbox + resumable multipart state machine (ARCHITECTURE §19).
 * Pure logic with injected ports: no DOM, no IndexedDB, no network here, so
 * every resume/kill/error path is unit-testable. The browser wires adapters.
 */

/** 5 MiB: R2's minimum part size and the atomic waste unit. Fixed for an upload's life. */
export const PART_SIZE = 5 * 1024 * 1024;

/**
 * Custody status — a first-class, exported state (§19). `vaulted` is set ONLY
 * after CompleteMultipartUpload is confirmed. A registered hash without vaulted
 * bytes is explicitly the weaker claim, and every export must say so.
 */
export type OriginalStatus = 'on_device_only' | 'vaulting' | 'vaulted' | 'lost';

export type ItemState =
	| 'queued' // nothing sent yet
	| 'registered' // phase 1 done: metadata + hashes recorded, receipt held
	| 'derivative_sent' // phase 2 done
	| 'uploading' // phase 3 in progress
	| 'completing' // all parts done; CompleteMultipartUpload not yet confirmed
	| 'done'
	| 'cancelled';

export interface PartRecord {
	n: number;
	etag: string;
}

export interface MultipartCursor {
	bucket: 'evidence-vault';
	key: string; // opaque ULID key — never content-derived (no existence oracle)
	uploadId: string;
	partSize: number;
	parts: PartRecord[];
	nextPart: number; // 1-based
}

export interface OutboxItem {
	id: string;
	state: ItemState;
	incidentReceipt?: string;
	derivative: {
		sha256: string;
		size: number;
		mime: string;
		uploaded: boolean;
	};
	original: {
		sha256: string;
		size: number;
		mime: string;
		r2?: MultipartCursor;
	};
	originalStatus: OriginalStatus;
	attempts: number;
	nextEarliestRetry: number; // epoch ms; 0 = now
	createdAt: number;
	maxAge: number;
}

/** Ciphertext source. Only sealed bytes are ever persisted or sliced (§19). */
export interface CipherSource {
	size: number;
	slice(start: number, end: number): Promise<Uint8Array>;
}

/** Persistence port. Implemented over IndexedDB in the browser; memory in tests. */
export interface OutboxStore {
	get(id: string): Promise<OutboxItem | undefined>;
	put(item: OutboxItem): Promise<void>;
	delete(id: string): Promise<void>;
	list(): Promise<OutboxItem[]>;
	/** Panic-wipe: destroy every row and cipher blob. Irreversible by design. */
	wipeAll(): Promise<void>;
}

/** media-worker presign API port (URLs are per-part, scope-bound, re-mintable). */
export interface PresignClient {
	createMultipart(item: OutboxItem): Promise<{ key: string; uploadId: string }>;
	presignPart(cursor: MultipartCursor, partNumber: number): Promise<string>;
	completeMultipart(cursor: MultipartCursor): Promise<void>;
	abortMultipart(cursor: MultipartCursor): Promise<void>;
	/** Confirm the object exists (idempotent-complete check). */
	headObject(cursor: MultipartCursor): Promise<boolean>;
}

export type TransportErrorKind =
	| 'expired' // 403 / expired signature → re-mint and retry, expected not exceptional
	| 'retryable' // 429 / 5xx / 408 / network drop → backoff and retry
	| 'invalid_part' // InvalidPart / malformed → local bug, abort this upload
	| 'no_such_upload'; // upload aged out → restart the multipart

export class TransportError extends Error {
	constructor(
		public kind: TransportErrorKind,
		message?: string
	) {
		super(message ?? kind);
		this.name = 'TransportError';
	}
}

/** Uploads one presigned part. Throws TransportError. */
export interface PartTransport {
	putPart(url: string, bytes: Uint8Array): Promise<{ etag: string }>;
}

export type LinkClass = 'slow' | 'medium' | 'fast';

/** Serial on 2G (parallelism there causes congestion collapse), 2 on 3G, 3 above. */
export function concurrencyFor(link: LinkClass): number {
	if (link === 'slow') return 1;
	if (link === 'medium') return 2;
	return 3;
}
