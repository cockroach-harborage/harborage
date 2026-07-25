/**
 * Helper-capacity bands (PRD §4.9).
 *
 * A PURE FUNCTION, AND NEVER SQL. The thresholds decide how much an adversary
 * learns from a published band, so they belong somewhere a test can sweep them,
 * not inside an INSERT nobody can reach. gate-no-enumeration enforces that: the
 * band value must arrive at the materializer as a bound parameter, and the file
 * doing the binding must import `bandFor`.
 */

export const BANDS = ['NONE', 'SOME', 'MANY'] as const;
export type Band = (typeof BANDS)[number];

export const TIERS = ['BASIC', 'HIGH'] as const;
export type Tier = (typeof TIERS)[number];

/**
 * Below this, the answer is NONE.
 *
 * NOT ZERO, and that is the whole design. If NONE meant "exactly none", then
 * SOME would mean "at least one", and a district with one lawyer would announce
 * that it has one lawyer. A floor makes one lawyer and no lawyers read the same.
 */
export const FLOOR: Record<Tier, number> = { BASIC: 4, HIGH: 4 };

/** At or above this, MANY. Wide enough that the step is not a near-exact count. */
export const MANY_AT: Record<Tier, number> = { BASIC: 12, HIGH: 12 };

/** Consecutive cycles at or above a threshold before a band steps UP. */
export const DWELL_CYCLES = 2;

/** The band a raw count maps to, ignoring hysteresis. */
export function bandFor(n: number, tier: Tier): Band {
	if (!Number.isFinite(n) || n < FLOOR[tier]) return 'NONE';
	return n >= MANY_AT[tier] ? 'MANY' : 'SOME';
}

/**
 * The band to publish, with hysteresis.
 *
 * WHY HYSTERESIS IS A PRIVACY CONTROL HERE, not a UI nicety. Without it an
 * observer who can watch successive cycles sees the band oscillate around a
 * threshold and can pin the true count to within one. Requiring several
 * consecutive cycles before stepping UP, and never stepping down inside the same
 * observation, removes that.
 *
 * Steps up only after DWELL_CYCLES consecutive cycles at the higher band. Steps
 * down immediately, because under-reporting capacity is the safe direction: it
 * sends nobody anywhere on a promise that is not there.
 */
export function nextBand(previous: Band, n: number, cyclesAtOrAbove: number, tier: Tier): Band {
	const target = bandFor(n, tier);
	if (BANDS.indexOf(target) <= BANDS.indexOf(previous)) return target;
	return cyclesAtOrAbove >= DWELL_CYCLES ? target : previous;
}
