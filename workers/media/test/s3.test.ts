import { describe, expect, it } from 'vitest';
import { buildCompleteXml, EVIDENCE_VAULT_BUCKET, R2S3 } from '../src/s3.ts';

describe('R2 S3 helper', () => {
	it('builds a part-sorted CompleteMultipartUpload body', () => {
		const xml = buildCompleteXml([
			{ n: 2, etag: '"b"' },
			{ n: 1, etag: '"a"' }
		]);
		expect(xml).toBe(
			'<CompleteMultipartUpload>' +
				'<Part><PartNumber>1</PartNumber><ETag>"a"</ETag></Part>' +
				'<Part><PartNumber>2</PartNumber><ETag>"b"</ETag></Part>' +
				'</CompleteMultipartUpload>'
		);
	});

	it('presigns a part PUT URL offline (query-signed, bytes never proxy the Worker)', async () => {
		const s3 = new R2S3('acct123', 'AKIAEXAMPLE', 'secretexample');
		const url = await s3.presignPart(EVIDENCE_VAULT_BUCKET, 'opaque-key', 'up1', 3);
		expect(url).toContain('acct123.r2.cloudflarestorage.com');
		expect(url).toContain(`/${EVIDENCE_VAULT_BUCKET}/opaque-key`);
		expect(url).toContain('partNumber=3');
		expect(url).toContain('uploadId=up1');
		expect(url).toContain('X-Amz-Signature=');
	});

	it('presigns a content-addressed derivative PUT URL', async () => {
		const s3 = new R2S3('acct123', 'AKIAEXAMPLE', 'secretexample');
		const url = await s3.presignPut('harborage-public-media', 'sha256/ab/abc');
		expect(url).toContain('/harborage-public-media/sha256/ab/abc');
		expect(url).toContain('X-Amz-Signature=');
	});
});
