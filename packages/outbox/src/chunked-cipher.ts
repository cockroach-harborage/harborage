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
import { open, seal } from '@harborage/crypto';
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

/**
 * Reconstruct the plaintext from concatenated sealed chunks.
 *
 * Until this existed nothing could rebuild a vaulted original: sealChunks had
 * no inverse anywhere in the codebase, so the sealed pristine copy on someone's
 * phone was write-only.
 *
 * `total` is DERIVED from the ciphertext length, never taken from a caller.
 * That is the whole integrity property here: the AAD binds each chunk's index
 * and the total, so an attacker who drops trailing chunks would, if `total`
 * were caller-supplied, be able to lower it to match and every remaining chunk
 * would still authenticate. Deriving it means a truncated blob computes a
 * smaller `total`, every chunk's AAD then mismatches, and the open fails.
 *
 * Returns null on any failure rather than throwing: a corrupt or tampered blob
 * is an expected outcome for data that has survived a phone and a flaky link.
 */
export function openChunks(
	key: Uint8Array,
	cipher: Uint8Array,
	fileBase: Uint8Array,
	chunkPlain: number = CHUNK_PLAIN
): Uint8Array | null {
	const sealedChunk = chunkPlain + SEAL_OVERHEAD;
	if (cipher.length <= SEAL_OVERHEAD) return null;

	// Every non-final chunk is exactly sealedChunk bytes; the final one is the
	// remainder. A blob whose length implies a zero-length final chunk is
	// malformed, not merely empty.
	const full = Math.floor(cipher.length / sealedChunk);
	const remainder = cipher.length - full * sealedChunk;
	const total = remainder === 0 ? full : full + 1;
	if (total === 0) return null;
	if (remainder !== 0 && remainder <= SEAL_OVERHEAD) return null;

	const parts: Uint8Array[] = [];
	for (let i = 0; i < total; i++) {
		const start = i * sealedChunk;
		const end = Math.min(start + sealedChunk, cipher.length);
		const isFinal = i === total - 1;
		try {
			parts.push(open(key, cipher.subarray(start, end), chunkAad(fileBase, i, total, isFinal)));
		} catch {
			return null;
		}
	}

	let size = 0;
	for (const p of parts) size += p.length;
	const out = new Uint8Array(size);
	let off = 0;
	for (const p of parts) {
		out.set(p, off);
		off += p.length;
	}
	return out;
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
