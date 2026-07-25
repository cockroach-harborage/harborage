import { describe, expect, it } from 'vitest';
import {
	BAND_DOWN,
	BAND_DWELL_TICKS,
	BAND_UP,
	nextBand,
	targetBand
} from '../src/liveboard/bands.ts';
import { BANDS, type Band } from '../src/liveboard/params.ts';

describe('a band is never a number', () => {
	it('returns only a band word, across the whole range', () => {
		let band: Band = 'none';
		for (let n = 0; n <= 10_000; n += 7) {
			band = nextBand(band, n, n, BAND_DWELL_TICKS);
			expect(BANDS).toContain(band);
		}
	});

	it('has five words and no digit in any of them', () => {
		expect(BANDS).toHaveLength(5);
		for (const b of BANDS) expect(b).not.toMatch(/\d/);
	});
});

describe('hysteresis is wide, and asymmetric on purpose', () => {
	/**
	 * Without a gap between the step-up and step-down thresholds, an observer
	 * watching successive ticks sees the band oscillate at a boundary and can pin
	 * the true count to within one step, which defeats the point of banding.
	 */
	it('keeps every step-down threshold at or below half its step-up', () => {
		// Direction-aware, like the gate: a WIDER gap is always fine, a narrower one
		// is not. Asserting an exact factor of two would have failed on 25/12 and
		// invited someone to move a threshold to satisfy the arithmetic rather than
		// the property.
		for (let i = 1; i < BAND_UP.length; i++) {
			expect(BAND_DOWN[i], `band ${i} down`).toBeLessThanOrEqual(BAND_UP[i]! / 2);
			expect(BAND_DOWN[i], `band ${i} down`).toBeGreaterThan(BAND_DOWN[i - 1]!);
			expect(BAND_UP[i], `band ${i} up`).toBeGreaterThan(BAND_UP[i - 1]!);
		}
	});

	it('will not step up before the dwell is served', () => {
		let band: Band = 'none';
		for (let tick = 1; tick < BAND_DWELL_TICKS; tick++) {
			band = nextBand(band, BAND_UP[1]!, BAND_UP[1]!, tick);
			expect(band, `tick ${tick}`).toBe('none');
		}
		expect(nextBand(band, BAND_UP[1]!, BAND_UP[1]!, BAND_DWELL_TICKS)).toBe('small');
	});

	/** Falling is immediate: under-reporting a crowd is the safe direction. */
	it('steps down at once, with no dwell', () => {
		expect(nextBand('very-large', 0, 0, 0)).toBe('none');
		expect(nextBand('large', 0, BAND_DOWN[1]! - 1, 0)).toBe('none');
	});

	/**
	 * Rises on the LOWER bound and falls on the UPPER one, so both movements err
	 * toward reporting less. This is only visible when the two differ, which is
	 * why the test passes them separately rather than passing one number twice.
	 */
	it('uses the lower bound to rise and the upper bound to fall', () => {
		// Lower bound says 'small', upper bound says 'moderate': must not rise on
		// the upper one.
		expect(nextBand('none', BAND_UP[1]!, BAND_UP[2]!, 99)).toBe('small');
		// Upper bound still inside 'moderate': must not fall on the lower one.
		expect(nextBand('moderate', 0, BAND_DOWN[2]!, 0)).toBe('moderate');
	});

	it('holds steady inside a band', () => {
		expect(nextBand('moderate', BAND_UP[2]! + 1, BAND_UP[2]! + 1, 99)).toBe('moderate');
	});
});

describe('targetBand', () => {
	it('agrees with where nextBand would settle given enough dwell', () => {
		for (const n of [0, 24, 25, 149, 150, 799, 800, 3999, 4000, 50_000]) {
			expect(nextBand('none', n, n, 99), `n=${n}`).toBe(targetBand(n));
		}
	});
});
