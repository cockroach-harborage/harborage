import { describe, expect, it } from 'vitest';
import {
	bandFor,
	nextBand,
	BANDS,
	DWELL_CYCLES,
	FLOOR,
	MANY_AT,
	TIERS,
	type Band
} from '../src/capacity.ts';

describe('bandFor', () => {
	/**
	 * THE PROPERTY THAT MATTERS: nothing this function returns is a number. A
	 * sweep rather than a few cases, because the failure mode is an off-by-one at
	 * a threshold rather than a wrong shape.
	 */
	it('returns only a band, for every count from zero to ten thousand', () => {
		for (const tier of TIERS) {
			for (let n = 0; n <= 10_000; n++) {
				expect(BANDS).toContain(bandFor(n, tier));
			}
		}
	});

	/**
	 * NONE covers a FLOOR, not exactly zero. If it meant "none at all", SOME
	 * would mean "at least one" and a district with one lawyer would announce
	 * that it has one lawyer. This is what makes one and zero read the same.
	 */
	it('reads one helper the same as no helpers', () => {
		for (const tier of TIERS) {
			for (let n = 0; n < FLOOR[tier]; n++) {
				expect(bandFor(n, tier), `n=${n}`).toBe('NONE');
			}
			expect(bandFor(FLOOR[tier], tier)).toBe('SOME');
		}
	});

	it('steps to MANY only at the upper threshold', () => {
		for (const tier of TIERS) {
			expect(bandFor(MANY_AT[tier] - 1, tier)).toBe('SOME');
			expect(bandFor(MANY_AT[tier], tier)).toBe('MANY');
		}
	});

	it('is monotone in the count', () => {
		for (const tier of TIERS) {
			let last = 0;
			for (let n = 0; n <= 500; n++) {
				const at = BANDS.indexOf(bandFor(n, tier));
				expect(at, `n=${n}`).toBeGreaterThanOrEqual(last);
				last = at;
			}
		}
	});

	it('treats nonsense as NONE rather than throwing', () => {
		expect(bandFor(Number.NaN, 'BASIC')).toBe('NONE');
		expect(bandFor(-5, 'BASIC')).toBe('NONE');
		expect(bandFor(Number.POSITIVE_INFINITY, 'BASIC')).toBe('NONE');
	});
});

describe('nextBand hysteresis', () => {
	/**
	 * WHY HYSTERESIS IS A PRIVACY CONTROL, not a UI nicety. An observer watching
	 * successive cycles sees an un-damped band oscillate around a threshold and
	 * can pin the true count to within one.
	 */
	it('will not step up before the dwell is served', () => {
		let band: Band = 'NONE';
		for (let cycle = 1; cycle < DWELL_CYCLES; cycle++) {
			band = nextBand(band, FLOOR.BASIC, cycle, 'BASIC');
			expect(band, `cycle ${cycle}`).toBe('NONE');
		}
		band = nextBand(band, FLOOR.BASIC, DWELL_CYCLES, 'BASIC');
		expect(band).toBe('SOME');
	});

	it('steps down immediately, because under-reporting is the safe direction', () => {
		expect(nextBand('MANY', 0, 0, 'BASIC')).toBe('NONE');
		expect(nextBand('SOME', 0, 0, 'BASIC')).toBe('NONE');
	});

	it('holds steady when the count has not crossed a threshold', () => {
		expect(nextBand('SOME', FLOOR.BASIC + 1, 99, 'BASIC')).toBe('SOME');
	});
});

describe('the vocabulary itself', () => {
	it('is three words and none of them is a number', () => {
		expect([...BANDS]).toEqual(['NONE', 'SOME', 'MANY']);
		for (const b of BANDS) expect(b).not.toMatch(/\d/);
	});

	/**
	 * A floor of 1 would make SOME mean "exactly one or more", which is the
	 * actionable number this whole design exists to not publish. Pinned so
	 * lowering it is a visible edit to a test, not a quiet tuning change.
	 */
	it('keeps the floor above one', () => {
		for (const tier of TIERS) expect(FLOOR[tier]).toBeGreaterThan(1);
	});
});
