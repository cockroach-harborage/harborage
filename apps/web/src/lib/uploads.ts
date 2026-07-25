/**
 * Off-device send (ARCHITECTURE §7.6, §19). Wires the record's sealed original +
 * redacted derivative to the api (register) and media (presign) Workers through
 * the packages/outbox orchestrator. Gated by document_intake: the client reads
 * /api/intake/status to show/hide the affordance, and the Workers are the real
 * fail-closed gate. Bytes go direct to R2 via presigned URLs — never through a
 * Worker. Nothing here runs while document_intake is OFF (all of M1).
 *
 * M2 note: the metadata envelope key scheme (how the moderation pipeline reads
 * the sealed register body) is finalized with the identity core; here the body
 * is sealed + framed only to satisfy the structural sealed-envelope check.
 */
import { NONCE_LENGTH as SEALED_BOX_NONCE_LENGTH, sealTo } from '@harborage/crypto/sealed-box';
import { ALG_SEALED_BOX_X25519, frameEnvelope } from '@harborage/worker-lib/envelope';
import { credentialHeaders } from '$lib/credential';
import { resolveIntakeKey } from '$lib/intake-key';
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
import type { LocalDocument } from '$lib/documents';

export interface IntakeStatus {
	document_intake: boolean;
	directory_intake: boolean;
	/** Hex public half of the intake sealed-box keypair, or null if unpublished. */
	intake_key: string | null;
}

const INTAKE_CLOSED: IntakeStatus = {
	document_intake: false,
	directory_intake: false,
	intake_key: null
};

/** Read the public feature-flag booleans; default OFF (offline / error / flag off). */
export async function getIntakeStatus(fetchFn: typeof fetch = fetch): Promise<IntakeStatus> {
	try {
		const res = await fetchFn('/api/intake/status');
		if (!res.ok) return INTAKE_CLOSED;
		const data = (await res.json()) as Partial<IntakeStatus>;
		return {
			document_intake: data.document_intake === true,
			directory_intake: data.directory_intake === true,
			intake_key: typeof data.intake_key === 'string' ? data.intake_key : null
		};
	} catch {
		return INTAKE_CLOSED;
	}
}

/**
 * POST to a media route with a per-request credential.
 *
 * The proof of possession binds to exactly the bytes sent, so the body is
 * serialised ONCE and both the signature and the request use that same string.
 * Re-serialising would produce a different byte sequence and a signature that
 * does not verify.
 */
async function postJson(path: string, body: unknown, fetchFn: typeof fetch): Promise<Response> {
	const text = JSON.stringify(body);
	const bytes = new TextEncoder().encode(text);
	const credential = await credentialHeaders('document', 'POST', path, bytes);
	return fetchFn(path, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...credential },
		body: text
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
		if (res.ok) return;
		// Map the status HONESTLY. This used to call every non-2xx
		// `no_such_upload`, which sends the uploader down the restart path: it
		// HEADs for the object, misses, drops the cursor and re-uploads every
		// part from zero. A transient 429 or 502 after 40 minutes of 2G would
		// silently throw away the whole upload. Only a genuinely gone upload
		// justifies that.
		if (res.status === 404 || res.status === 409)
			throw new TransportError('no_such_upload', `complete ${res.status}`);
		if (res.status === 400) throw new TransportError('invalid_part', `complete ${res.status}`);
		throw new TransportError('retryable', `complete ${res.status}`);
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

/**
 * Seal the register metadata to the intake public key.
 *
 * The previous version minted a content key, sealed with it, and dropped it on
 * the floor, so every register body ever sent would have been permanently
 * undecryptable by anyone including us. It satisfied the structural
 * sealed-envelope check and nothing else.
 *
 * SEALED-TO-PLATFORM, not end-to-end: this body is destined for the public
 * incident record, so the consumer must be able to read it. It buys hop
 * confidentiality and blast-radius hardening, and nothing against compulsion.
 */
function metadataEnvelope(record: LocalDocument, intakeKey: Uint8Array): Uint8Array {
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
	// Fresh ephemeral seed AND nonce per envelope. Reusing the seed across two
	// messages to the same recipient repeats the content key, which loses
	// confidentiality for both.
	const ephemeralSeed = new Uint8Array(32);
	const nonce = new Uint8Array(SEALED_BOX_NONCE_LENGTH);
	crypto.getRandomValues(ephemeralSeed);
	crypto.getRandomValues(nonce);
	const boxed = sealTo(
		intakeKey,
		new TextEncoder().encode(JSON.stringify(meta)),
		ephemeralSeed,
		nonce
	);
	ephemeralSeed.fill(0);
	return frameEnvelope(boxed, ALG_SEALED_BOX_X25519);
}

export type SendOutcome = 'sent' | 'not_open' | 'failed';

/**
 * Send a keep-on-phone record off device: register the sealed metadata, then
 * (for media records) upload the redacted derivative and the sealed original.
 * Returns 'not_open' when document_intake is OFF (the Worker returns 403).
 */
export async function sendRecord(
	record: LocalDocument,
	store: OutboxStore,
	fetchFn: typeof fetch = fetch
): Promise<SendOutcome> {
	const media = new MediaPresignClient(fetchFn);
	const transport = new R2PartTransport(fetchFn);
	const uploader = new MultipartUploader(store, media, transport);

	const status = await getIntakeStatus(fetchFn);
	const intake = await resolveIntakeKey(status.intake_key);
	// No key published, or a key that changed since we pinned it: refuse rather
	// than seal to something unverified. Sending to a swapped key would hand the
	// note to whoever swapped it.
	if (intake.status !== 'ok') return 'not_open';

	const register = {
		async register(): Promise<string> {
			const envelope = metadataEnvelope(record, intake.publicKey);
			// The proof of possession binds to these exact bytes, so build it from
			// the envelope we are about to send rather than from anything derived.
			const credential = await credentialHeaders(
				'document',
				'POST',
				'/api/incidents/register',
				envelope
			);
			const res = await fetchFn('/api/incidents/register', {
				method: 'POST',
				headers: { 'content-type': 'application/octet-stream', ...credential },
				body: new Blob([envelope as BlobPart])
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
		originalStatus: record.original ? 'on_device_only' : 'none',
		attempts: 0,
		nextEarliestRetry: 0,
		createdAt: record.createdAt,
		maxAge: 30 * 24 * 3600 * 1000
	};
	await store.put(item);

	const orchestrator = new OutboxOrchestrator(store, register, derivative, uploader, cipher);
	try {
		// Note-only and vault-only records still go through the orchestrator. The
		// previous shortcut called register() directly, so the receipt was never
		// persisted and the row sat at `queued` forever -- indistinguishable from
		// a send that never happened.
		await orchestrator.advance(item);
		return 'sent';
	} catch (e) {
		if (e instanceof NotOpenError) return 'not_open';
		return 'failed';
	}
}

class NotOpenError extends Error {}
