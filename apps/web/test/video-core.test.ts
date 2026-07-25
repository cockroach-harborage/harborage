/**
 * Video disposition (ARCHITECTURE §7.5:338-342, §19:1314-1319).
 *
 * Two properties carry the weight: no input produces a public video, and a
 * frame that decoded to nothing is a failure rather than a poster.
 */
import { describe, expect, it } from 'vitest';
import {
	BLANK_FRAME_LUMA_RANGE,
	codecFromContainer,
	isBlankFrame,
	POSTER_PROBE_TIMEOUT_MS,
	videoDisposition,
	type PosterOutcome
} from '../src/lib/pipeline/video-core.ts';

const BUILT: PosterOutcome = { kind: 'built', codec: 'avc' };
const FAILED: PosterOutcome = { kind: 'decode_failed', codec: 'hevc', reason: 'no_decode' };

describe('what happens to a video', () => {
	it('seals every video, whether or not a still could be made', () => {
		for (const poster of [BUILT, FAILED, null]) {
			expect(videoDisposition(poster).admission).toBe('SEALED_ONLY');
		}
	});

	it('offers no public artifact when the still could not be made', () => {
		expect(videoDisposition(FAILED).publicArtifact).toBe('none');
		expect(videoDisposition(null).publicArtifact).toBe('none');
	});

	it('offers only a poster, never the video, when the still worked', () => {
		const d = videoDisposition(BUILT);
		expect(d.publicArtifact).toBe('poster');
		expect(d.admission).toBe('SEALED_ONLY');
	});

	it('has no reachable combination that publishes a video', () => {
		const outcomes: (PosterOutcome | null)[] = [
			null,
			BUILT,
			{ kind: 'built', codec: 'hevc' },
			{ kind: 'decode_failed', codec: 'avc', reason: 'no_decode' },
			{ kind: 'decode_failed', codec: 'avc', reason: 'blank_frame' },
			{ kind: 'decode_failed', codec: 'av1', reason: 'timeout' }
		];
		for (const o of outcomes) {
			const d = videoDisposition(o);
			expect(d.admission).toBe('SEALED_ONLY');
			expect(['poster', 'none']).toContain(d.publicArtifact);
		}
	});
});

describe('a frame that decoded to nothing', () => {
	it('is treated as a decode failure, not as a picture', () => {
		// Android WebView draws an all-black canvas from video it could not decode:
		// seeked fires, drawImage succeeds, and the poster is a black rectangle.
		expect(isBlankFrame(0)).toBe(true);
		expect(isBlankFrame(BLANK_FRAME_LUMA_RANGE)).toBe(true);
	});

	it('lets a real frame through', () => {
		expect(isBlankFrame(BLANK_FRAME_LUMA_RANGE + 1)).toBe(false);
		expect(isBlankFrame(200)).toBe(false);
	});

	it('gives up rather than hanging on a video that never seeks', () => {
		expect(POSTER_PROBE_TIMEOUT_MS).toBeGreaterThan(0);
		expect(POSTER_PROBE_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
	});
});

describe('naming what could not be read', () => {
	function ftyp(brand: string): Uint8Array {
		const b = new Uint8Array(16);
		b.set([0, 0, 0, 0x18], 0);
		b.set([0x66, 0x74, 0x79, 0x70], 4); // 'ftyp'
		for (let i = 0; i < 4; i++) b[8 + i] = brand.charCodeAt(i);
		return b;
	}

	it('reads hevc, avc, av1 and webm from the container header', () => {
		expect(codecFromContainer(ftyp('hev1'))).toBe('hevc');
		expect(codecFromContainer(ftyp('heic'))).toBe('hevc');
		expect(codecFromContainer(ftyp('isom'))).toBe('avc');
		expect(codecFromContainer(ftyp('mp42'))).toBe('avc');
		expect(codecFromContainer(ftyp('av01'))).toBe('av1');
		expect(codecFromContainer(ftyp('qt  '))).toBe('quicktime');
		expect(codecFromContainer(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0]))).toBe('webm');
	});

	it('says unknown rather than guessing', () => {
		expect(codecFromContainer(new Uint8Array(16))).toBe('unknown');
		expect(codecFromContainer(new Uint8Array(2))).toBe('unknown');
	});

	it('names a codec and never a handset', () => {
		// A device string is a fingerprint, and it would be the one identifying
		// field in an otherwise clean provenance row.
		const names = ['hev1', 'isom', 'av01', 'qt  '].map((b) => codecFromContainer(ftyp(b)));
		for (const n of names) {
			expect(n).toMatch(/^[a-z0-9:.\- ]+$/);
			expect(n.length).toBeLessThan(24);
		}
	});
});
