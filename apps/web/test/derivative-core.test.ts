import { describe, expect, it } from 'vitest';
import {
	boxToPixels,
	coverageSampleRect,
	encodeQuality,
	isFillPixel,
	linkClassFrom,
	sampleStride,
	scaledSize,
	targetLongEdge,
	COVERAGE_INSET_PX,
	FILL_TOLERANCE,
	LEGIBILITY_MIN_LONG_EDGE,
	MAX_LONG_EDGE,
	MIN_QUALITY
} from '../src/lib/pipeline/derivative-core';

describe('link class', () => {
	it('treats save-data and 2g as slow', () => {
		expect(linkClassFrom({ saveData: true, effectiveType: '4g' })).toBe('slow');
		expect(linkClassFrom({ effectiveType: '2g' })).toBe('slow');
		expect(linkClassFrom({ effectiveType: 'slow-2g' })).toBe('slow');
	});

	it('treats 3g and 4g as fast', () => {
		expect(linkClassFrom({ effectiveType: '3g' })).toBe('fast');
		expect(linkClassFrom({ effectiveType: '4g' })).toBe('fast');
	});

	// The safer failure: a smaller file on a link that might be 2G. It costs
	// legibility nothing, because the floor is what actually bounds quality.
	it('defaults an unknown link to slow', () => {
		expect(linkClassFrom(null)).toBe('slow');
		expect(linkClassFrom(undefined)).toBe('slow');
		expect(linkClassFrom({})).toBe('slow');
		expect(linkClassFrom({ effectiveType: 'something-new' })).toBe('slow');
	});
});

describe('legibility floor', () => {
	it('never drops a large capture below the floor, even on 2G', () => {
		expect(targetLongEdge('slow', 6000)).toBe(LEGIBILITY_MIN_LONG_EDGE);
		expect(targetLongEdge('slow', 1281)).toBe(LEGIBILITY_MIN_LONG_EDGE);
	});

	it('never upscales a source that is already small', () => {
		expect(targetLongEdge('slow', 800)).toBe(800);
		expect(targetLongEdge('fast', 800)).toBe(800);
	});

	it('caps a fast link at the useful ceiling', () => {
		expect(targetLongEdge('fast', 12000)).toBe(MAX_LONG_EDGE);
	});

	it('never encodes below the quality floor', () => {
		expect(encodeQuality('slow')).toBeGreaterThanOrEqual(MIN_QUALITY);
		expect(encodeQuality('fast')).toBeGreaterThanOrEqual(encodeQuality('slow'));
	});

	it('preserves aspect and never returns a zero dimension', () => {
		expect(scaledSize(4000, 3000, 2048)).toEqual({ width: 2048, height: 1536 });
		expect(scaledSize(3000, 4000, 2048)).toEqual({ width: 1536, height: 2048 });
		// A pathologically thin source must still round up to a real pixel.
		expect(scaledSize(4000, 1, 100).height).toBe(1);
	});
});

describe('cover box geometry', () => {
	// The safety-relevant direction. A box that shrank by one pixel leaves an
	// uncovered sliver of a face that nobody reviewed.
	it('rounds outward, never inward', () => {
		const rect = boxToPixels({ x: 0.101, y: 0.101, w: 0.1, h: 0.1 }, 1000, 1000)!;
		expect(rect.x).toBeLessThanOrEqual(101);
		expect(rect.y).toBeLessThanOrEqual(101);
		expect(rect.x + rect.w).toBeGreaterThanOrEqual(201);
		expect(rect.y + rect.h).toBeGreaterThanOrEqual(201);
	});

	it('never grows past the canvas', () => {
		const rect = boxToPixels({ x: 0.9, y: 0.9, w: 0.5, h: 0.5 }, 100, 100)!;
		expect(rect.x + rect.w).toBeLessThanOrEqual(100);
		expect(rect.y + rect.h).toBeLessThanOrEqual(100);
	});

	it('drops a box with no area rather than painting nothing silently', () => {
		expect(boxToPixels({ x: 0.5, y: 0.5, w: 0, h: 0.2 }, 100, 100)).toBeNull();
		expect(boxToPixels({ x: 2, y: 2, w: 0.2, h: 0.2 }, 100, 100)).toBeNull();
	});
});

describe('coverage sampling', () => {
	it('insets away from the lossy edge but stays inside the box', () => {
		const sample = coverageSampleRect({ x: 10, y: 10, w: 100, h: 100 });
		expect(sample.x).toBeGreaterThan(10);
		expect(sample.y).toBeGreaterThan(10);
		expect(sample.x + sample.w).toBeLessThan(110);
		expect(sample.y + sample.h).toBeLessThan(110);
	});

	/**
	 * The bug this test exists for. An earlier version inset by 8% of the box,
	 * which is invisible on a small box and catastrophic on a large one: a 700px
	 * cover box would skip a 56px band inside the region the human confirmed, so
	 * a paint offset of tens of pixels along an edge left part of a face
	 * uncovered and still verified clean. Found by sabotaging the paint offset
	 * and watching nothing fail.
	 *
	 * Ringing is a property of the codec, not of the box, so the inset must not
	 * scale with the box.
	 */
	it('insets by a fixed number of pixels, not a fraction of the box', () => {
		const small = coverageSampleRect({ x: 0, y: 0, w: 40, h: 40 });
		const large = coverageSampleRect({ x: 0, y: 0, w: 900, h: 900 });
		expect(small.x).toBe(COVERAGE_INSET_PX);
		expect(large.x).toBe(COVERAGE_INSET_PX);
		// The unchecked band on a large box stays a few pixels wide, not tens.
		expect(900 - large.w).toBeLessThanOrEqual(2 * COVERAGE_INSET_PX);
	});

	// A tiny distant-face box must still be CHECKED, not skipped. Skipping is how
	// a verification step quietly becomes decorative.
	it('always yields at least one pixel to check, however small the box', () => {
		for (const size of [1, 2, 3, 4, 5, 8]) {
			const sample = coverageSampleRect({ x: 0, y: 0, w: size, h: size });
			expect(sample.w).toBeGreaterThanOrEqual(1);
			expect(sample.h).toBeGreaterThanOrEqual(1);
			expect(sample.x + sample.w).toBeLessThanOrEqual(size);
			expect(sample.y + sample.h).toBeLessThanOrEqual(size);
		}
	});

	it('strides a large region instead of reading every pixel', () => {
		expect(sampleStride({ x: 0, y: 0, w: 4, h: 4 })).toBe(1);
		expect(sampleStride({ x: 0, y: 0, w: 2000, h: 2000 })).toBeGreaterThan(1);
	});
});

describe('fill detection', () => {
	it('accepts solid black and lossy drift around it', () => {
		expect(isFillPixel(0, 0, 0)).toBe(true);
		expect(isFillPixel(FILL_TOLERANCE, FILL_TOLERANCE, FILL_TOLERANCE)).toBe(true);
	});

	it('rejects anything a viewer could read as image content', () => {
		expect(isFillPixel(FILL_TOLERANCE + 1, 0, 0)).toBe(false);
		expect(isFillPixel(128, 128, 128)).toBe(false);
		expect(isFillPixel(255, 255, 255)).toBe(false);
	});

	// The tolerance is sized for codec drift on a solid region. If it ever grew
	// far enough to admit mid-grey, the check would stop meaning anything.
	it('keeps the tolerance far below readable content', () => {
		expect(FILL_TOLERANCE).toBeLessThan(64);
	});
});
