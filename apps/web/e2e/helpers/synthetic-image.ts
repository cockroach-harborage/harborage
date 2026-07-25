import { deflateSync } from 'node:zlib';

/**
 * A synthetic PNG for the redaction pixel test.
 *
 * Built here rather than committed as a fixture so the test can state exactly
 * what it depends on: every pixel is deliberately BRIGHT, so "this region is
 * solid black fill" and "this region still shows image content" are
 * unambiguous, and a covered region cannot pass by accident because the source
 * happened to be dark there.
 *
 * It also carries a random canary in a PNG tEXt chunk. Re-encoding through a
 * canvas drops all metadata by construction; the test asserts the canary is
 * absent from the shipped derivative, which is a real check that the public
 * copy carries none of the original's metadata.
 *
 * ~40 lines of encoder instead of an image dependency, per the CLAUDE.md rule.
 */

const CRC_TABLE = (() => {
	const t = new Int32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c;
	}
	return t;
})();

function crc32(buf: Buffer): number {
	let c = -1;
	for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
	return (c ^ -1) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length, 0);
	const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body), 0);
	return Buffer.concat([len, body, crc]);
}

export interface SyntheticImage {
	buffer: Buffer;
	width: number;
	height: number;
	/** Random hex string embedded in the PNG's text metadata. */
	canary: string;
}

/**
 * An 8-bit RGB PNG whose every channel is comfortably above the fill tolerance,
 * with a repeating hue pattern so no large area is uniform.
 */
export function syntheticImage(width = 2400, height = 1800): SyntheticImage {
	const canary = Array.from({ length: 32 }, () =>
		Math.floor(Math.random() * 256)
			.toString(16)
			.padStart(2, '0')
	).join('');

	const stride = width * 3 + 1;
	const raw = Buffer.alloc(stride * height);
	for (let y = 0; y < height; y++) {
		const row = y * stride;
		raw[row] = 0; // filter: none
		for (let x = 0; x < width; x++) {
			const o = row + 1 + x * 3;
			const cell = ((x >> 5) + (y >> 5)) & 1;
			// Nothing below 90 in any channel: FILL_TOLERANCE is 24, so any pixel
			// here is unmistakably content rather than fill.
			raw[o] = cell ? 240 : 150 + ((x * 7) % 90);
			raw[o + 1] = cell ? 120 + ((y * 5) % 100) : 210;
			raw[o + 2] = cell ? 90 + ((x + y) % 120) : 130;
		}
	}

	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 2; // colour type: truecolour RGB
	ihdr[10] = 0;
	ihdr[11] = 0;
	ihdr[12] = 0;

	return {
		buffer: Buffer.concat([
			Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
			chunk('IHDR', ihdr),
			chunk('tEXt', Buffer.from(`Comment\0${canary}`, 'latin1')),
			chunk('IDAT', deflateSync(raw, { level: 6 })),
			chunk('IEND', Buffer.alloc(0))
		]),
		width,
		height,
		canary
	};
}

/**
 * Longest run of bytes shared between two buffers, capped at `cap`.
 *
 * Used to assert the public derivative contains none of the vault original's
 * bytes. Low-entropy windows (a run of one repeated byte) are skipped: two
 * unrelated image files both contain runs of zeros, and counting those would
 * make the assertion fire on nothing meaningful.
 */
export function longestSharedRun(a: Buffer, b: Buffer, window = 24, cap = 4096): number {
	const seen = new Set<string>();
	for (let i = 0; i + window <= a.length; i++) {
		const slice = a.subarray(i, i + window);
		let uniform = true;
		for (let k = 1; k < window; k++)
			if (slice[k] !== slice[0]) {
				uniform = false;
				break;
			}
		if (uniform) continue;
		seen.add(slice.toString('latin1'));
		if (seen.size > 400_000) break; // bound the memory on a large original
	}
	let longest = 0;
	for (let i = 0; i + window <= b.length && longest < cap; i++) {
		if (!seen.has(b.subarray(i, i + window).toString('latin1'))) continue;
		let n = window;
		while (
			i + n < b.length &&
			longest + 1 < cap &&
			seen.has(b.subarray(i + n - window + 1, i + n + 1).toString('latin1'))
		)
			n++;
		if (n > longest) longest = n;
	}
	return longest;
}
