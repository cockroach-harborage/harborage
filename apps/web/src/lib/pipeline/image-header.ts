/**
 * Intrinsic image dimensions from the file header alone (ARCHITECTURE §19 step 2).
 *
 * WHY THIS EXISTS. §19 requires reading dimensions "cheaply (header/ImageDecoder
 * metadata, not a full decode)" so the downscale factor is known BEFORE any
 * pixels are allocated. The M1 code called `createImageBitmap(blob)` with no
 * resize options, which fully decodes a 12-108 MP photo into RGBA — a 108 MP
 * shot is ~432 MB of bitmap on a phone with 1-2 GB of RAM. That is an OOM on
 * exactly the devices this project exists to serve, and it was invisible to
 * types and to every test.
 *
 * PURE BY CONSTRUCTION: no imports, no DOM, no globals. `apps/web/vitest.config.ts`
 * has no `$lib` alias and no DOM, so anything unit-tested there must import
 * nothing — same split as identity-core.ts and verification-map.ts.
 *
 * Returns null on anything it does not recognise. The caller falls back to
 * `ImageDecoder` and then to a full decode; a null here is "I could not tell",
 * never "this image is broken".
 */

export interface Dimensions {
	width: number;
	height: number;
}

function u16be(b: Uint8Array, at: number): number {
	return (b[at]! << 8) | b[at + 1]!;
}
function u16le(b: Uint8Array, at: number): number {
	return b[at]! | (b[at + 1]! << 8);
}
function u24le(b: Uint8Array, at: number): number {
	return b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16);
}
function u32be(b: Uint8Array, at: number): number {
	return ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;
}
function u32le(b: Uint8Array, at: number): number {
	return (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;
}
function ascii(b: Uint8Array, at: number, s: string): boolean {
	for (let i = 0; i < s.length; i++) if (b[at + i] !== s.charCodeAt(i)) return false;
	return true;
}

function ok(width: number, height: number): Dimensions | null {
	// A zero or absurd dimension means we misparsed, not that the image is huge.
	// Better to admit we do not know than to hand back a bogus downscale factor.
	if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
	if (width < 1 || height < 1 || width > 100_000 || height > 100_000) return null;
	return { width, height };
}

/** JPEG: walk the marker segments to the first Start-Of-Frame. */
function jpeg(b: Uint8Array): Dimensions | null {
	let at = 2; // past SOI
	while (at + 9 < b.length) {
		if (b[at] !== 0xff) {
			at++; // resync over fill bytes rather than giving up
			continue;
		}
		const marker = b[at + 1]!;
		// Standalone markers carry no length.
		if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
			at += 2;
			continue;
		}
		if (marker === 0xd9 || marker === 0xda) return null; // EOI / start of scan
		const len = u16be(b, at + 2);
		if (len < 2) return null;
		const isSof =
			(marker >= 0xc0 && marker <= 0xc3) ||
			(marker >= 0xc5 && marker <= 0xc7) ||
			(marker >= 0xc9 && marker <= 0xcb) ||
			(marker >= 0xcd && marker <= 0xcf);
		if (isSof) return ok(u16be(b, at + 7), u16be(b, at + 5));
		at += 2 + len;
	}
	return null;
}

/** WebP: three container variants, each with its own dimension encoding. */
function webp(b: Uint8Array): Dimensions | null {
	if (b.length < 30) return null;
	if (ascii(b, 12, 'VP8X')) return ok(u24le(b, 24) + 1, u24le(b, 27) + 1);
	if (ascii(b, 12, 'VP8L')) {
		const bits = u32le(b, 21);
		return ok((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
	}
	if (ascii(b, 12, 'VP8 ')) {
		// Lossy: 3-byte frame tag, then the 0x9d012a start code, then 14-bit dims.
		if (!(b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a)) return null;
		return ok(u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff);
	}
	return null;
}

/**
 * Read `width` and `height` from the leading bytes of an image file.
 * A few hundred bytes is enough for every format here, so the caller can slice
 * the head of a Blob instead of reading a multi-MB file into memory.
 */
export function readImageDimensions(bytes: Uint8Array): Dimensions | null {
	const b = bytes;
	if (b.length < 16) return null;

	// PNG: 8-byte signature, then IHDR width/height at fixed offsets.
	if (b[0] === 0x89 && ascii(b, 1, 'PNG')) return ok(u32be(b, 16), u32be(b, 20));

	// GIF87a / GIF89a: logical screen descriptor immediately after the header.
	if (ascii(b, 0, 'GIF8')) return ok(u16le(b, 6), u16le(b, 8));

	// RIFF container: WebP is the only one we handle.
	if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) return webp(b);

	// BMP: signed 32-bit LE, and a negative height means bottom-up, not an error.
	if (ascii(b, 0, 'BM') && b.length >= 26)
		return ok(u32le(b, 18) | 0, Math.abs(u32le(b, 22) | 0));

	if (b[0] === 0xff && b[1] === 0xd8) return jpeg(b);

	// HEIC/AVIF and anything else: caller falls back to ImageDecoder. Parsing an
	// ISO-BMFF box tree here would be a real parser on untrusted bytes, which is
	// not worth it when the platform already has one.
	return null;
}

/** Enough leading bytes for every format above, including a long JPEG APP1. */
export const HEADER_PROBE_BYTES = 64 * 1024;
