/**
 * The client-side board cache, and the STALE rule.
 *
 * This module is where §6.5's "safety-critical hazard reads fail to
 * last-cached-with-STALE-badge, never dark" actually lives. The server can only
 * decline to answer; whether the user still sees the last known hazards is
 * decided here.
 *
 * THE RULE THAT MATTERS: an EMPTY board is never allowed to silently replace a
 * non-empty one while the board says it is rebuilding. After a Durable Object
 * eviction the board comes back empty, and empty is indistinguishable from "no
 * hazards here" — so trusting it would clear a tear-gas row off the screen at the
 * exact moment the person reading it is deciding which way to walk. It is
 * withheld until the board stops saying `rebuilding`.
 *
 * THE HONEST BOUND: a cached row is dropped once it is older than the signal TTL.
 * Showing a hazard for longer than the board would have kept it is not caution,
 * it is a lie with a badge on it, and a badge is not consent to be misled.
 */
import { SIGNAL_TTL_MS, TICK_MS } from '@harborage/worker-lib/liveboard';

/** Ticks of age before a snapshot is presented as stale. */
export const STALE_AFTER_TICKS = 2;

/**
 * Hard expiry for a cached snapshot. Deliberately the board's own signal TTL: the
 * client must not present a hazard for longer than the board itself would have.
 */
export const CACHE_MAX_AGE_MS = SIGNAL_TTL_MS;

export interface BoardSignalRow {
	signal: string;
	corroborated: boolean;
	marshal_verified: boolean;
}

/** What one fetch produced. `tick` is a coarse grid index, never a timestamp. */
export interface BoardSnapshot {
	zone_id: string;
	tick: number;
	band: string | null;
	signals: readonly BoardSignalRow[];
	/** Device clock, used only for the hard expiry. Never sent anywhere. */
	storedAtMs: number;
}

/** The four things the read route can say, mapped to one closed vocabulary. */
export type FetchOutcome =
	| {
			kind: 'board';
			tick: number;
			rebuilding: boolean;
			band: string | null;
			signals: readonly BoardSignalRow[];
	  }
	/** The flag is off, or the server said stale, or the request failed. */
	| { kind: 'unavailable' };

export interface Presented {
	snapshot: BoardSnapshot | null;
	stale: boolean;
	/**
	 * True when nothing is on screen and nothing can be: no cache, nothing served.
	 * The surface says so in words rather than rendering an empty list, because an
	 * empty list reads as "no hazards" and that is a claim.
	 */
	blank: boolean;
}

/**
 * Fold one fetch outcome into what the user sees.
 *
 * Pure, and takes `nowMs` rather than reading the clock, so every branch is
 * reachable from a test without fake timers.
 */
export function reconcile(
	prev: BoardSnapshot | null,
	outcome: FetchOutcome,
	zoneId: string,
	nowMs: number
): Presented {
	const kept =
		prev && nowMs - prev.storedAtMs <= CACHE_MAX_AGE_MS && prev.zone_id === zoneId ? prev : null;

	if (outcome.kind === 'unavailable') return { snapshot: kept, stale: true, blank: kept === null };

	const incoming: BoardSnapshot = {
		zone_id: zoneId,
		tick: outcome.tick,
		band: outcome.band,
		signals: outcome.signals,
		storedAtMs: nowMs
	};

	// THE LOAD-BEARING BRANCH. A rebuilding board with nothing on it has not told
	// us the hazards are gone, only that it has forgotten them. Keep what we have.
	if (outcome.rebuilding && outcome.signals.length === 0 && kept !== null)
		return { snapshot: kept, stale: true, blank: false };

	// A rebuilding board that DOES have signals is worth showing — it is coming
	// back and these rows already cleared the floor — but it is still incomplete.
	if (outcome.rebuilding) return { snapshot: incoming, stale: true, blank: false };

	// A fresh, non-rebuilding, empty board is a real answer: the hazards expired.
	// This is the one path that clears rows, and it requires the board to be
	// speaking for itself.
	return { snapshot: incoming, stale: false, blank: false };
}

/**
 * Age-based staleness, applied on every render rather than only on fetch.
 *
 * Separate from reconcile() because a snapshot goes stale by the passage of time
 * with no fetch involved at all: a backgrounded tab, a dead network, a phone in a
 * pocket. A badge that only appeared on a failed request would stay absent
 * exactly when nothing is being requested.
 */
export function isAged(snapshot: BoardSnapshot | null, nowMs: number): boolean {
	if (snapshot === null) return true;
	if (nowMs - snapshot.storedAtMs > CACHE_MAX_AGE_MS) return true;
	return Math.floor(nowMs / TICK_MS) - snapshot.tick > STALE_AFTER_TICKS;
}

/** Everything the surface needs, with both staleness sources folded together. */
export function present(
	prev: BoardSnapshot | null,
	outcome: FetchOutcome,
	zoneId: string,
	nowMs: number
): Presented {
	const r = reconcile(prev, outcome, zoneId, nowMs);
	return { ...r, stale: r.stale || isAged(r.snapshot, nowMs) };
}
