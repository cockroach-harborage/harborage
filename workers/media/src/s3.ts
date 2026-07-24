/**
 * R2 S3-API helper (ARCHITECTURE §3.1, §7.6). The media Worker mints presigned
 * URLs and runs the tiny multipart control-plane calls — bytes NEVER proxy the
 * Worker: the browser PUTs each part directly to R2 with a presigned URL. Uses
 * aws4fetch (local HMAC signing, no network for signing).
 */
import { AwsClient } from 'aws4fetch';

export const EVIDENCE_VAULT_BUCKET = 'harborage-evidence-vault';
export const PUBLIC_MEDIA_BUCKET = 'harborage-public-media';

export interface CompletedPart {
	n: number;
	etag: string; // as returned in the PUT response ETag header (quotes included)
}

/**
 * Escape the three characters that must be escaped in XML element content.
 * The literal quotes around an S3 ETag are part of its value and are left
 * intact; only `& < >` are escaped so an injected value cannot break the frame.
 */
function xmlEscape(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Validate + narrow untrusted client-supplied parts. The part list comes from
 * the browser; an unvalidated ETag string interpolated into the signed
 * CompleteMultipartUpload body is an injection surface. Reject anything that is
 * not {n: positive int ≤ 10000, etag: quoted hex}. Throws on bad input.
 */
export function validateParts(input: unknown): CompletedPart[] {
	if (!Array.isArray(input) || input.length === 0 || input.length > 10000)
		throw new Error('bad parts');
	return input.map((raw) => {
		const p = raw as { n?: unknown; etag?: unknown };
		if (typeof p.n !== 'number' || !Number.isInteger(p.n) || p.n < 1 || p.n > 10000)
			throw new Error('bad part number');
		// R2/S3 ETags for a part are a quoted hex MD5 (optionally with a "-N" suffix
		// for multipart), e.g. "\"9b2cf5...\"". Allow only that shape.
		if (typeof p.etag !== 'string' || !/^"[0-9a-fA-F]{32}(-\d+)?"$/.test(p.etag))
			throw new Error('bad etag');
		return { n: p.n, etag: p.etag };
	});
}

/** Build the CompleteMultipartUpload request body. Pure — unit-testable offline. */
export function buildCompleteXml(parts: CompletedPart[]): string {
	const items = parts
		.slice()
		.sort((a, b) => a.n - b.n)
		.map((p) => `<Part><PartNumber>${p.n}</PartNumber><ETag>${xmlEscape(p.etag)}</ETag></Part>`)
		.join('');
	return `<CompleteMultipartUpload>${items}</CompleteMultipartUpload>`;
}

export class R2S3 {
	private client: AwsClient;
	private endpoint: string;

	constructor(accountId: string, accessKeyId: string, secretAccessKey: string) {
		this.client = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' });
		this.endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
	}

	private objUrl(bucket: string, key: string): string {
		// Encode each path segment but keep the slashes between them.
		const path = key
			.split('/')
			.map((s) => encodeURIComponent(s))
			.join('/');
		return `${this.endpoint}/${bucket}/${path}`;
	}

	async createMultipart(bucket: string, key: string): Promise<string> {
		const res = await this.client.fetch(`${this.objUrl(bucket, key)}?uploads`, { method: 'POST' });
		if (!res.ok) throw new Error(`create ${res.status}`);
		const xml = await res.text();
		const m = xml.match(/<UploadId>([^<]+)<\/UploadId>/);
		if (!m) throw new Error('no uploadId');
		return m[1]!;
	}

	async presignPart(
		bucket: string,
		key: string,
		uploadId: string,
		partNumber: number,
		ttlSeconds = 900
	): Promise<string> {
		const url = new URL(this.objUrl(bucket, key));
		url.searchParams.set('partNumber', String(partNumber));
		url.searchParams.set('uploadId', uploadId);
		url.searchParams.set('X-Amz-Expires', String(ttlSeconds));
		const signed = await this.client.sign(new Request(url, { method: 'PUT' }), {
			aws: { signQuery: true }
		});
		return signed.url;
	}

	async completeMultipart(
		bucket: string,
		key: string,
		uploadId: string,
		parts: CompletedPart[]
	): Promise<void> {
		const url = new URL(this.objUrl(bucket, key));
		url.searchParams.set('uploadId', uploadId);
		const res = await this.client.fetch(url, { method: 'POST', body: buildCompleteXml(parts) });
		if (!res.ok) throw new Error(`complete ${res.status}`);
	}

	async abortMultipart(bucket: string, key: string, uploadId: string): Promise<void> {
		const url = new URL(this.objUrl(bucket, key));
		url.searchParams.set('uploadId', uploadId);
		await this.client.fetch(url, { method: 'DELETE' });
	}

	async headObject(bucket: string, key: string): Promise<boolean> {
		const res = await this.client.fetch(this.objUrl(bucket, key), { method: 'HEAD' });
		return res.ok;
	}

	async presignPut(bucket: string, key: string, ttlSeconds = 900): Promise<string> {
		const url = new URL(this.objUrl(bucket, key));
		url.searchParams.set('X-Amz-Expires', String(ttlSeconds));
		const signed = await this.client.sign(new Request(url, { method: 'PUT' }), {
			aws: { signQuery: true }
		});
		return signed.url;
	}
}
