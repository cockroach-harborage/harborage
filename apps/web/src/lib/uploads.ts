/**
 * Off-device send (ARCHITECTURE §7.6, §19). Wires the record's sealed original +
 * redacted derivative to the api (register) and media (presign) Workers through
 * the packages/outbox orchestrator. Gated by record_intake: the client reads
 * /api/intake/status to show/hide the affordance, and the Workers are the real
 * fail-closed gate. Bytes go direct to R2 via presigned URLs — never through a
 * Worker. Nothing here runs while record_intake is OFF (all of M1).
 *
 * M2 note: the metadata envelope key scheme (how the moderation pipeline reads
 * the sealed register body) is finalized with the identity core; here the body
 * is sealed + framed only to satisfy the structural sealed-envelope check.
 */
import { newContentKey, seal } from '@harborage/crypto';
import { frameEnvelope } from '@harborage/worker-lib/envelope';
import {
	BlobCipherSource,
	MultipartUploader,
	OutboxOrchestrator,
	TransportError,
	type CipherSource,
	type MultipartCursor,
	type OutboxItem,
	type OutboxStore,
	type PartTransport,
	type PresignClient
} from '@harborage/outbox';
import type { LocalRecord } from '$lib/records';

export interface IntakeStatus {
	record_intake: boolean;
	directory_intake: boolean;
}

/** Read the public feature-flag booleans; default OFF (offline / error / flag off). */
export async function getIntakeStatus(fetchFn: typeof fetch = fetch): Promise<IntakeStatus> {
	try {
		const res = await fetchFn('/api/intake/status');
		if (!res.ok) return { record_intake: false, directory_intake: false };
		const data = (await res.json()) as Partial<IntakeStatus>;
		return {
			record_intake: data.record_intake === true,
			directory_intake: data.directory_intake === true
		};
	} catch {
		return { record_intake: false, directory_intake: false };
	}
}

async function postJson(path: string, body: unknown, fetchFn: typeof fetch): Promise<Response> {
	return fetchFn(path, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
}

/** PresignClient over the media Worker (vault multipart). */
class MediaPresignClient implements PresignClient {
	constructor(private readonly fetchFn: typeof fetch) {}
	async createMultipart(): Promise<{ key: string; uploadId: string }> {
		const res = await postJson('/media/create', {}, this.fetchFn);
		if (!res.ok) throw new TransportError('retryable', `create ${res.status}`);
		return (await res.json()) as { key: string; uploadId: string };
	}
	async presignPart(cursor: MultipartCursor, partNumber: number): Promise<string> {
		const res = await postJson(
			'/media/part',
			{ key: cursor.key, uploadId: cursor.uploadId, partNumber },
			this.fetchFn
		);
		if (!res.ok) throw new TransportError('retryable', `part ${res.status}`);
		return ((await res.json()) as { url: string }).url;
	}
	async completeMultipart(cursor: MultipartCursor): Promise<void> {
		const res = await postJson(
			'/media/complete',
			{ key: cursor.key, uploadId: cursor.uploadId, parts: cursor.parts.map((p) => ({ n: p.n, etag: p.etag })) },
			this.fetchFn
		);
		if (!res.ok) throw new TransportError('no_such_upload', `complete ${res.status}`);
	}
	async abortMultipart(cursor: MultipartCursor): Promise<void> {
		await postJson('/media/abort', { key: cursor.key, uploadId: cursor.uploadId }, this.fetchFn);
	}
	async headObject(cursor: MultipartCursor): Promise<boolean> {
		const res = await postJson('/media/head', { key: cursor.key }, this.fetchFn);
		if (!res.ok) return false;
		return ((await res.json()) as { exists: boolean }).exists === true;
	}
}

/** Uploads one presigned part directly to R2 and reads its ETag. */
class R2PartTransport implements PartTransport {
	constructor(private readonly fetchFn: typeof fetch) {}
	async putPart(url: string, bytes: Uint8Array): Promise<{ etag: string }> {
		const res = await this.fetchFn(url, { method: 'PUT', body: new Blob([bytes as BlobPart]) });
		if (res.status === 403) throw new TransportError('expired', 'presign expired');
		if (!res.ok) throw new TransportError('retryable', `put ${res.status}`);
		const etag = res.headers.get('ETag');
		if (!etag) throw new TransportError('invalid_part', 'no ETag');
		return { etag };
	}
}

function metadataEnvelope(record: LocalRecord): Uint8Array {
	const meta = {
		type: record.type,
		note: record.note,
		area: record.area,
		occurred_date: record.occurredDate,
		source_link: record.sourceLink,
		original_sha256: record.original?.sha256,
		derivative_sha256: record.derivative?.sha256,
		redaction_confirmed: record.redactionConfirmed
	};
	const key = newContentKey();
	return frameEnvelope(seal(key, new TextEncoder().encode(JSON.stringify(meta))));
}

export type SendOutcome = 'sent' | 'not_open' | 'failed';

/**
 * Send a keep-on-phone record off device: register the sealed metadata, then
 * (for media records) upload the redacted derivative and the sealed original.
 * Returns 'not_open' when record_intake is OFF (the Worker returns 403).
 */
export async function sendRecord(
	record: LocalRecord,
	store: OutboxStore,
	fetchFn: typeof fetch = fetch
): Promise<SendOutcome> {
	const media = new MediaPresignClient(fetchFn);
	const transport = new R2PartTransport(fetchFn);
	const uploader = new MultipartUploader(store, media, transport);

	const register = {
		async register(): Promise<string> {
			const res = await fetchFn('/api/incidents/register', {
				method: 'POST',
				headers: { 'content-type': 'application/octet-stream' },
				body: new Blob([metadataEnvelope(record) as BlobPart])
			});
			if (res.status === 403) throw new NotOpenError();
			if (!res.ok) throw new TransportError('retryable', `register ${res.status}`);
			return ((await res.json()) as { receipt: string }).receipt;
		}
	};

	const derivative = {
		async uploadDerivative(): Promise<void> {
			if (!record.derivative) return; // vault-only / note record: nothing public to send
			const res = await postJson('/media/derivative', { sha256: record.derivative.sha256 }, fetchFn);
			if (!res.ok) throw new TransportError('retryable', `derivative ${res.status}`);
			const { url } = (await res.json()) as { url: string };
			const put = await fetchFn(url, { method: 'PUT', body: record.derivative.blob });
			if (!put.ok) throw new TransportError('retryable', `derivative put ${put.status}`);
		}
	};

	const cipher = {
		async getCipher(): Promise<CipherSource> {
			if (!record.original) return new BlobCipherSource(new Blob([]));
			return new BlobCipherSource(record.original.sealed);
		}
	};

	const item: OutboxItem = {
		id: record.id,
		state: 'queued',
		derivative: {
			sha256: record.derivative?.sha256 ?? '',
			size: record.derivative?.blob.size ?? 0,
			mime: record.derivative?.mime ?? '',
			uploaded: false
		},
		original: {
			sha256: record.original?.sha256 ?? '',
			size: record.original?.sealed.size ?? 0,
			mime: record.original?.mime ?? ''
		},
		originalStatus: record.original ? 'on_device_only' : 'vaulted',
		attempts: 0,
		nextEarliestRetry: 0,
		createdAt: record.createdAt,
		maxAge: 30 * 24 * 3600 * 1000
	};
	await store.put(item);

	const orchestrator = new OutboxOrchestrator(store, register, derivative, uploader, cipher);
	try {
		// Note-only / vault-only records have no original: register only, then stop.
		if (!record.original) {
			await register.register();
			return 'sent';
		}
		await orchestrator.advance(item);
		return 'sent';
	} catch (e) {
		if (e instanceof NotOpenError) return 'not_open';
		return 'failed';
	}
}

class NotOpenError extends Error {}
