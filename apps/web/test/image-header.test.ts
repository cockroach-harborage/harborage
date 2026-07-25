import { describe, expect, it } from 'vitest';
import { readImageDimensions } from '../src/lib/pipeline/image-header';

/**
 * These headers are hand-built rather than fixture files, so the test states the
 * byte layout it depends on. The point of this module is to learn a photo's size
 * WITHOUT decoding it, so a wrong answer here means either an OOM on a 108 MP
 * capture or a derivative at the wrong resolution.
 */

function bytes(...parts: (number[] | string)[]): Uint8Array {
	const flat: number[] = [];
	for (const p of parts) {
		if (typeof p === 'string') for (const c of p) flat.push(c.charCodeAt(0));
		else flat.push(...p);
	}
	return new Uint8Array(flat);
}
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le16 = (n: number) => [n & 255, (n >>> 8) & 255];
const le24 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];
const pad = (n: number) => new Array(n).fill(0);

describe('PNG', () => {
	it('reads IHDR width and height', () => {
		const png = bytes(
			[0x89],
			'PNG',
			[0x0d, 0x0a, 0x1a, 0x0a],
			be32(13),
			'IHDR',
			be32(4032),
			be32(3024),
			pad(8)
		);
		expect(readImageDimensions(png)).toEqual({ width: 4032, height: 3024 });
	});
});

describe('JPEG', () => {
	it('walks past APP segments to the first start-of-frame', () => {
		const app1 = bytes([0xff, 0xe1], [0x00, 0x10], pad(14)); // a 16-byte EXIF-ish segment
		const sof0 = bytes([0xff, 0xc0], [0x00, 0x11], [0x08], [0x0b, 0xb8], [0x0f, 0xa0], pad(10));
		const jpg = bytes([0xff, 0xd8], [...app1], [...sof0]);
		expect(readImageDimensions(jpg)).toEqual({ width: 4000, height: 3000 });
	});

	it('reads progressive JPEG (SOF2) too', () => {
		const sof2 = bytes([0xff, 0xc2], [0x00, 0x11], [0x08], [0x04, 0x38], [0x07, 0x80], pad(10));
		expect(readImageDimensions(bytes([0xff, 0xd8], [...sof2]))).toEqual({
			width: 1920,
			height: 1080
		});
	});

	// A truncated or scan-only JPEG must say "I do not know", not guess. The
	// caller then falls back to ImageDecoder and finally to a full decode.
	it('returns null rather than guessing when there is no frame header', () => {
		expect(readImageDimensions(bytes([0xff, 0xd8], [0xff, 0xda], [0x00, 0x08], pad(20)))).toBeNull();
	});
});

describe('WebP', () => {
	it('reads the lossy VP8 frame header', () => {
		const webp = bytes(
			'RIFF',
			pad(4),
			'WEBP',
			'VP8 ',
			pad(4),
			[0x00, 0x00, 0x00],
			[0x9d, 0x01, 0x2a],
			le16(1600),
			le16(1200),
			pad(4)
		);
		expect(readImageDimensions(webp)).toEqual({ width: 1600, height: 1200 });
	});

	it('reads the extended VP8X canvas size', () => {
		const webp = bytes(
			'RIFF',
			pad(4),
			'WEBP',
			'VP8X',
			pad(4),
			[0x10],
			pad(3),
			le24(2047),
			le24(1535),
			pad(4)
		);
		expect(readImageDimensions(webp)).toEqual({ width: 2048, height: 1536 });
	});
});

describe('GIF', () => {
	it('reads the logical screen descriptor', () => {
		expect(readImageDimensions(bytes('GIF89a', le16(320), le16(240), pad(8)))).toEqual({
			width: 320,
			height: 240
		});
	});
});

describe('refusing to answer', () => {
	it('declines an unknown container rather than returning a bogus scale factor', () => {
		expect(readImageDimensions(bytes(pad(64)))).toBeNull();
		expect(readImageDimensions(bytes('ftypheic', pad(32)))).toBeNull();
	});

	it('declines a truncated file', () => {
		expect(readImageDimensions(new Uint8Array(4))).toBeNull();
	});

	// A misparse that yields 0 or an absurd size would produce a nonsense
	// downscale factor, which is worse than admitting we could not tell.
	it('rejects an implausible parsed size', () => {
		const zeroPng = bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a], be32(13), 'IHDR', be32(0), be32(100), pad(8));
		expect(readImageDimensions(zeroPng)).toBeNull();
	});
});
