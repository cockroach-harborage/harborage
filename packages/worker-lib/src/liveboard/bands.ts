/**
 * Crowd bands (ARCHITECTURE §6.4; PRD §4.5).
 *
 * NO EXPORTED FUNCTION HERE RETURNS A NUMBER FOR CROWD SIZE. `nextBand` returns
 * a `Band`, so the read path cannot render a count because it never receives
 * one. That is the structural form of "coarse bands, never counts": not a rule
 * the renderer follows, but a value it does not have.
 */
import { BANDS, type Band } from './params.ts';

/**
 * Where a band STARTS, on the lower bound.
 *
 * Wide and roughly geometric, so a step is never close to a specific figure.
 * Index matches BANDS: none, small, moderate, large, very-large.
 */
export const BAND_UP: readonly number[] = [0, 25, 150, 800, 4000];

/**
 * Where a band ENDS, on the upper bound.
 *
 * HALF the step-up thresholds, which is §6.4's "wide hysteresis". Without a gap,
 * an observer watching successive ticks sees the band oscillate at a boundary
 * and can pin the true count to within one step, which defeats the point of
 * banding.
 */
export const BAND_DOWN: readonly number[] = [0, 12, 75, 400, 2000];

/** Consecutive ticks at or above a threshold before a band steps up. */
export const BAND_DWELL_TICKS = 2;

function indexFor(thresholds: readonly number[], n: number): number {
	let at = 0;
	for (let i = 0; i < thresholds.length; i++) if (n >= (thresholds[i] ?? 0)) at = i;
	return at;
}

/**
 * The band to publish.
 *
 * Rises on the LOWER bound and falls on the UPPER one, so both movements err
 * toward reporting less. Rising also needs a dwell; falling is immediate,
 * because under-reporting a crowd is the safe direction — it sends nobody
 * anywhere on a promise that is not there.
 */
export function nextBand(
	current: Band,
	lowerBound: number,
	upperBound: number,
	ticksAtOrAbove: number
): Band {
	const at = BANDS.indexOf(current);
	const up = indexFor(BAND_UP, lowerBound);
	const down = indexFor(BAND_DOWN, upperBound);

	if (down < at) return BANDS[down] ?? 'none';
	if (up > at && ticksAtOrAbove >= BAND_DWELL_TICKS) return BANDS[up] ?? current;
	return current;
}

/** The band a lower bound would reach with no hysteresis. For the dwell counter. */
export function targetBand(lowerBound: number): Band {
	return BANDS[indexFor(BAND_UP, lowerBound)] ?? 'none';
}
