import { describe, expect, it } from 'vitest';
import { newContentKey, open } from '@harborage/crypto';
import {
	BytesCipherSource,
	CHUNK_PLAIN,
	SEAL_OVERHEAD,
	openChunks,
	chunkAad,
	concatChunks,
	sealChunks
} from '../src/chunked-cipher.ts';
import { PART_SIZE } from '../src/types.ts';

const fileBase = new Uint8Array(32).fill(9); // stands in for original_sha256
const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

describe('part-aligned chunked seal', () => {
	it('a non-final sealed chunk is exactly PART_SIZE (arithmetic invariant)', () => {
		expect(CHUNK_PLAIN + SEAL_OVERHEAD).toBe(PART_SIZE);
	});

	it('non-final chunks are equal-sized and each opens with its own AAD', () => {
		const key = newContentKey();
		const cp = 64;
		const plain = new Uint8Array(cp * 2 + 10);
		for (let i = 0; i < plain.length; i++) plain[i] = i & 0xff;
		const chunks = sealChunks(key, plain, fileBase, cp);
		expect(chunks.length).toBe(3);
		expect(chunks[0]!.length).toBe(cp + SEAL_OVERHEAD);
		expect(chunks[1]!.length).toBe(cp + SEAL_OVERHEAD);
		expect(chunks[2]!.length).toBe(10 + SEAL_OVERHEAD);
		expect(eq(open(key, chunks[0]!, chunkAad(fileBase, 0, 3, false)), plain.subarray(0, 64))).toBe(
			true
		);
		expect(eq(open(key, chunks[1]!, chunkAad(fileBase, 1, 3, false)), plain.subarray(64, 128))).toBe(
			true
		);
		expect(eq(open(key, chunks[2]!, chunkAad(fileBase, 2, 3, true)), plain.subarray(128, 138))).toBe(
			true
		);
	});

	it('rejects a reordered chunk (index bound in AAD)', () => {
		const key = newContentKey();
		const chunks = sealChunks(key, new Uint8Array(128), fileBase, 64);
		// opening chunk 1 with chunk 0's AAD (wrong index) must throw
		expect(() => open(key, chunks[1]!, chunkAad(fileBase, 0, 2, false))).toThrow();
	});

	it('rejects a truncation (total + final-marker bound in AAD)', () => {
		const key = newContentKey();
		const chunks = sealChunks(key, new Uint8Array(69), fileBase, 64); // 2 chunks: full + final
		// attacker drops the final chunk and re-labels chunk 0 as the sole final chunk
		expect(() => open(key, chunks[0]!, chunkAad(fileBase, 0, 1, true))).toThrow();
	});

	it('rejects a cross-file splice (per-file base bound in AAD)', () => {
		const key = newContentKey();
		const chunks = sealChunks(key, new Uint8Array(64), fileBase, 64);
		const otherBase = new Uint8Array(32).fill(7);
		expect(() => open(key, chunks[0]!, chunkAad(otherBase, 0, 1, true))).toThrow();
	});

	it('real PART_SIZE: two chunks slice byte-stable at PART_SIZE', async () => {
		const key = newContentKey();
		const plain = new Uint8Array(CHUNK_PLAIN + 100);
		plain[0] = 42;
		plain[CHUNK_PLAIN] = 43; // a byte in each chunk
		const chunks = sealChunks(key, plain, fileBase); // default CHUNK_PLAIN
		expect(chunks.length).toBe(2);
		expect(chunks[0]!.length).toBe(PART_SIZE);
		const src = new BytesCipherSource(concatChunks(chunks));
		expect(src.size).toBe(PART_SIZE + 100 + SEAL_OVERHEAD);
		const part0 = await src.slice(0, PART_SIZE);
		const part1 = await src.slice(PART_SIZE, src.size);
		expect(eq(open(key, part0, chunkAad(fileBase, 0, 2, false)), plain.subarray(0, CHUNK_PLAIN))).toBe(
			true
		);
		expect(eq(open(key, part1, chunkAad(fileBase, 1, 2, true)), plain.subarray(CHUNK_PLAIN))).toBe(
			true
		);
	});
});

describe('openChunks', () => {
	const key = new Uint8Array(32).fill(2);
	const fileBase = new Uint8Array(32).fill(8);
	const plain = new Uint8Array(1000).map((_, i) => i % 251);
	const CP = 100; // small chunkPlain so alignment is provable without a 5 MiB seal

	function sealed(p = plain, base = fileBase) {
		return concatChunks(sealChunks(key, p, base, CP));
	}

	it('round-trips a multi-chunk blob', () => {
		expect(openChunks(key, sealed(), fileBase, CP)).toEqual(plain);
	});

	it('round-trips a single short chunk and an exact multiple', () => {
		const short = new Uint8Array(7).fill(1);
		expect(openChunks(key, sealed(short), fileBase, CP)).toEqual(short);
		const exact = new Uint8Array(CP * 3).fill(4);
		expect(openChunks(key, sealed(exact), fileBase, CP)).toEqual(exact);
	});

	// The reason total is derived rather than passed in. If a caller supplied
	// total, an attacker who dropped trailing chunks could lower it to match and
	// every remaining chunk would still authenticate against its AAD.
	it('detects truncation', () => {
		const cipher = sealed();
		const oneChunkShort = cipher.subarray(0, cipher.length - (CP + SEAL_OVERHEAD));
		expect(openChunks(key, oneChunkShort, fileBase, CP)).toBeNull();
		expect(openChunks(key, cipher.subarray(0, cipher.length - 1), fileBase, CP)).toBeNull();
	});

	it('detects reordering and splicing between files', () => {
		const chunks = sealChunks(key, plain, fileBase, CP);
		const swapped = concatChunks([chunks[1]!, chunks[0]!, ...chunks.slice(2)]);
		expect(openChunks(key, swapped, fileBase, CP)).toBeNull();

		// A chunk lifted from a different file has a different fileBase in its AAD.
		const other = sealChunks(key, plain, new Uint8Array(32).fill(9), CP);
		const spliced = concatChunks([chunks[0]!, other[1]!, ...chunks.slice(2)]);
		expect(openChunks(key, spliced, fileBase, CP)).toBeNull();
	});

	it('rejects the wrong key, the wrong fileBase, and tampering', () => {
		const cipher = sealed();
		expect(openChunks(new Uint8Array(32).fill(3), cipher, fileBase, CP)).toBeNull();
		expect(openChunks(key, cipher, new Uint8Array(32).fill(9), CP)).toBeNull();
		const tampered = cipher.slice();
		tampered[50] = (tampered[50] ?? 0) ^ 0xff;
		expect(openChunks(key, tampered, fileBase, CP)).toBeNull();
	});

	it('rejects blobs too short to be even one chunk', () => {
		expect(openChunks(key, new Uint8Array(0), fileBase, CP)).toBeNull();
		expect(openChunks(key, new Uint8Array(SEAL_OVERHEAD), fileBase, CP)).toBeNull();
	});
});
