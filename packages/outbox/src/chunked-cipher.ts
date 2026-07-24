/**
 * Part-aligned chunked sealing (design review; ARCHITECTURE §7.5, §19).
 *
 * The pristine original is sealed at outbox-commit into concatenated
 * XChaCha20-Poly1305 chunks where every NON-FINAL sealed chunk is EXACTLY
 * PART_SIZE. That lets MultipartUploader slice byte-stable ciphertext: a dropped
 * 5 MiB part is re-sent alone, RAM never holds 2x the file, and a resume never
 * re-encrypts. The AAD binds chunk index + total + final-marker + a per-file base
 * (original_sha256) so a compelled platform cannot reorder, truncate, or splice
 * chunks across files undetectably.
 *
 * seal()/open() come from the frozen crypto module — no new primitive, no wasm,
 * no DOM on the seal path. BlobCipherSource (browser) and BytesCipherSource
 * (tests / small bodies) adapt stored ciphertext to the CipherSource the uploader
 * slices.
 */
import { seal } from '@harborage/crypto';
import type { CipherSource } from './types.ts';
import { PART_SIZE } from './types.ts';

/** seal() overhead: 24-byte nonce + 16-byte Poly1305 tag. */
export const SEAL_OVERHEAD = 24 + 16;
/** Plaintext bytes per chunk so the sealed chunk is exactly PART_SIZE. */
export const CHUNK_PLAIN = PART_SIZE - SEAL_OVERHEAD;

/** AAD = fileBase || u32be(index) || u32be(total) || u8(isFinal). */
export function chunkAad(
	fileBase: Uint8Array,
	index: number,
	total: number,
	isFinal: boolean
): Uint8Array {
	const aad = new Uint8Array(fileBase.length + 9);
	aad.set(fileBase, 0);
	const dv = new DataView(aad.buffer, fileBase.length, 9);
	dv.setUint32(0, index, false);
	dv.setUint32(4, total, false);
	aad[fileBase.length + 8] = isFinal ? 1 : 0;
	return aad;
}

export function chunkCount(plainSize: number, chunkPlain: number = CHUNK_PLAIN): number {
	return Math.max(1, Math.ceil(plainSize / chunkPlain));
}

/**
 * Seal a whole plaintext buffer into ordered, part-aligned sealed chunks.
 * `chunkPlain` is injectable so tests can prove alignment without a 5 MiB seal;
 * production always uses CHUNK_PLAIN. Concatenated, the chunks are the cipher
 * blob the uploader slices. In the browser the pipeline worker streams this to a
 * Blob / IndexedDB rather than holding it all in RAM.
 */
export function sealChunks(
	key: Uint8Array,
	plaintext: Uint8Array,
	fileBase: Uint8Array,
	chunkPlain: number = CHUNK_PLAIN
): Uint8Array[] {
	const total = chunkCount(plaintext.length, chunkPlain);
	const chunks: Uint8Array[] = [];
	for (let i = 0; i < total; i++) {
		const start = i * chunkPlain;
		const end = Math.min(start + chunkPlain, plaintext.length);
		const isFinal = i === total - 1;
		chunks.push(seal(key, plaintext.subarray(start, end), chunkAad(fileBase, i, total, isFinal)));
	}
	return chunks;
}

/** Concatenate sealed chunks into a single cipher buffer. */
export function concatChunks(chunks: Uint8Array[]): Uint8Array {
	let total = 0;
	for (const c of chunks) total += c.length;
	const out = new Uint8Array(total);
	let off = 0;
	for (const c of chunks) {
		out.set(c, off);
		off += c.length;
	}
	return out;
}

/** CipherSource over an in-memory concatenated cipher buffer (tests, small bodies). */
export class BytesCipherSource implements CipherSource {
	constructor(private readonly bytes: Uint8Array) {}
	get size(): number {
		return this.bytes.length;
	}
	async slice(start: number, end: number): Promise<Uint8Array> {
		return this.bytes.subarray(start, end);
	}
}

/** CipherSource over a stored ciphertext Blob (browser: IndexedDB cipher-blobs). */
export class BlobCipherSource implements CipherSource {
	constructor(private readonly blob: Blob) {}
	get size(): number {
		return this.blob.size;
	}
	async slice(start: number, end: number): Promise<Uint8Array> {
		return new Uint8Array(await this.blob.slice(start, end).arrayBuffer());
	}
}
