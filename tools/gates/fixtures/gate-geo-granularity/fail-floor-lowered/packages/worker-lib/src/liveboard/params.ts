/**
 * Live-board safety parameters (ARCHITECTURE §6.4; PRD §4.5).
 *
 * ONE FILE, PINNED BY A GATE, and the gate compares DIRECTIONS rather than
 * values. `expect(DENSITY_FLOOR_D).toBe(5)` is a test that whoever lowers the
 * floor edits in the same commit, so it protects nothing. A direction-aware
 * check means tightening always passes and loosening never does, which is the
 * asymmetry `REQUIRED_SIGNATURES` already uses.
 *
 * §6.4 marks every value here as requiring adversary-modelling and counsel
 * sign-off before switch-on. They are pinned so a change is visible, not
 * because they are settled.
 */

/**
 * Coarsest publication unit, and the finest anything may ever be.
 *
 * geohash-6 is roughly 1.2 km by 0.6 km. Red line 3 forbids anything finer,
 * anywhere, and gate-geo-granularity refuses a higher number wherever it appears.
 */
export const MAX_GEOHASH_PRECISION = 6;

/**
 * Suppress-until-safe-density: distinct reporters before ANY signal shows.
 *
 * A handful of people must never become a visible dot on the board. This is
 * consumed as a LOWER BOUND, never a point estimate: a sketch reading 6 when the
 * truth is 4 publishes exactly the signal this floor exists to hide.
 */
export const DENSITY_FLOOR_D = 3;

/** Distinct reporters before a hazard is published as corroborated. */
export const CORROBORATION_K = 3;

/**
 * Publication lag. Base plus a per-(zone, signal, epoch) jitter.
 *
 * The jitter is DERIVED, never re-rolled per read. A per-read roll would let a
 * client polling twice a second watch the signal blink and pin the true report
 * time to within one poll, which makes the whole delay theatre.
 */
export const PUBLICATION_DELAY_BASE_MS = 60_000;
export const PUBLICATION_JITTER_MAX_MS = 120_000;

/** How long a signal lives before lazy expiry drops it. */
export const SIGNAL_TTL_MS = 10 * 60_000;

/**
 * Dedup-salt rotation period.
 *
 * On rotation the sketch RESETS. Keeping it would double-count a reporter who
 * reports across the boundary, and inflation is the direction that pushes a small
 * group over the density floor.
 */
export const DEDUP_EPOCH_MS = 15 * 60_000;

/** SAFE_EXIT and DISPERSAL need this many distinct marshal signatures. */
export const MARSHAL_QUORUM_M = 2;

/**
 * ...drawn from a directory of at least this many marshal keys.
 *
 * §8.2's bar is "at least 2 of at least 3 DISTINCT" keys. Without the second
 * half, a directory holding exactly two keys satisfies m and not n, and
 * verifyNotice() has no floor of this kind today. That is a real gap this
 * milestone closes.
 */
export const MARSHAL_QUORUM_MIN_KEYS = 3;

/**
 * Crowd bands. Five words, no counts, disabled entirely under heightened threat.
 *
 * No exported function anywhere in the live board returns a number for crowd
 * size, which is what makes "never a count" structural: the read path cannot
 * render one because it never receives one.
 */
export const BANDS = ['none', 'small', 'moderate', 'large', 'very-large'] as const;
export type Band = (typeof BANDS)[number];

/** Grid quantum for the read view. Deliberately coarse. */
export const TICK_MS = 30_000;

/**
 * How long a freshly-constructed board reports `rebuilding`.
 *
 * After eviction the board comes back empty, and empty is indistinguishable from
 * "no hazards here". This window is what lets the client keep showing its cached
 * rows with a STALE badge instead of flashing to nothing, which is the concrete
 * form §6.5's "never dark" takes.
 */
export const REBUILD_TICKS = 4;
