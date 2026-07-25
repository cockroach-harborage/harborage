/**
 * Reading the board, and the heartbeat that keeps it alive.
 *
 * THE HEARTBEAT IS THREE THINGS AT ONCE, which is why it is not merely a refresh
 * timer. A LiveBoard holds its state in memory only, and an idle Durable Object is
 * evicted after 70–140 seconds. So the reporters' own re-posts are:
 *
 *   the durability mechanism — the board is rebuilt from them after an eviction;
 *   the clock — nothing needs a tick when nobody is reporting;
 *   the keep-alive — 45 s sits under the 70 s eviction floor.
 *
 * It is idempotent for free: same certificate, same epoch, same dedup token, so a
 * re-post is a no-op insert rather than a second reporter.
 *
 * HONEST FAILURE MODES, and they belong in the copy, not only here. Heartbeats
 * stop when the tab is hidden, so a signal lapses about a minute after the last
 * reporter pockets their phone. THIS BOARD WORKS WHILE PEOPLE ARE LOOKING AT IT;
 * IT IS NOT LIVE MONITORING. If every reporter drops for more than the eviction
 * window the publication delay clock restarts LATER, never earlier — the failure
 * direction is "shown late", never "shown early", which is the safe one.
 */
import { isZoneId } from '@harborage/worker-lib/liveboard';
import type { FetchOutcome } from './liveboard-cache.ts';

/** Base heartbeat interval. Under the 70 s eviction floor, with room for jitter. */
export const HEARTBEAT_BASE_MS = 45_000;
/** Symmetric jitter, so a fleet of clients does not report in lockstep. */
export const HEARTBEAT_JITTER_MS = 10_000;
/**
 * Longest a client keeps reporting without the person touching anything.
 *
 * A tab left open on a desk would otherwise report indefinitely, which is a
 * reporter who is not there and a count the density floor should not have.
 */
export const HEARTBEAT_MAX_MS = 10 * 60_000;

/** How long a read may hold the connection open. Mirrors the route's clamp. */
export const READ_WAIT_MS = 25_000;

/**
 * The next heartbeat delay, 45 s ± 10 s.
 *
 * `rand` is injected so the spread is testable. The jitter is symmetric on
 * purpose: a one-sided jitter would push the mean above the eviction floor and
 * the board would die between beats for the slowest clients.
 */
export function nextHeartbeatMs(rand: () => number = Math.random): number {
	return HEARTBEAT_BASE_MS + Math.round((rand() * 2 - 1) * HEARTBEAT_JITTER_MS);
}

/** Whether a reporting session has run out its own clock. */
export function heartbeatExpired(startedAtMs: number, nowMs: number): boolean {
	return nowMs - startedAtMs >= HEARTBEAT_MAX_MS;
}

/**
 * Whether to send a heartbeat at all.
 *
 * Visibility is a hard precondition, not a preference: a hidden tab reporting is a
 * reporter who is not looking at the situation they are attesting to, and the
 * density floor treats it as a person present.
 */
export function shouldHeartbeat(opts: {
	visible: boolean;
	startedAtMs: number;
	nowMs: number;
}): boolean {
	return opts.visible && !heartbeatExpired(opts.startedAtMs, opts.nowMs);
}

interface ReadResponseBody {
	published?: unknown;
	stale?: unknown;
	board?: unknown;
}

/**
 * Fetch one board view and reduce it to the closed FetchOutcome vocabulary.
 *
 * EVERY FAILURE COLLAPSES TO 'unavailable' — a non-200, a malformed body, a
 * network error, `published: false`, `stale: true`. The cache decides what the
 * user sees; this function's only job is to never invent a board. In particular a
 * malformed response must not become an EMPTY board, because an empty board is
 * what clears hazard rows off a screen.
 */
export async function fetchBoard(
	zoneId: string,
	opts: {
		fetch: typeof globalThis.fetch;
		sinceTick?: number;
		waitMs?: number;
		signal?: AbortSignal;
	}
): Promise<FetchOutcome> {
	// Refused locally. A zone id is a Durable Object instance name, and asking for
	// one that is not on the verified list is asking the edge to create a namespace
	// entry of the caller's choosing.
	if (!isZoneId(zoneId)) return { kind: 'unavailable' };

	const params = new URLSearchParams();
	params.set('wait', String(Math.min(opts.waitMs ?? 0, READ_WAIT_MS)));
	if (opts.sinceTick !== undefined) params.set('since', String(opts.sinceTick));

	try {
		const res = await opts.fetch(`/api/live/${zoneId}?${params}`, {
			method: 'GET',
			...(opts.signal ? { signal: opts.signal } : {})
		});
		if (!res.ok) return { kind: 'unavailable' };
		const body = (await res.json()) as ReadResponseBody;
		if (body.published !== true || body.stale === true) return { kind: 'unavailable' };
		return parseBoard(body.board);
	} catch {
		return { kind: 'unavailable' };
	}
}

/**
 * Validate the board object field by field.
 *
 * Written out rather than trusted because this object decides what a person reads
 * while choosing which way to walk. Anything unexpected is 'unavailable', which
 * keeps the cache, rather than a partially-parsed board, which would replace it.
 */
function parseBoard(value: unknown): FetchOutcome {
	if (typeof value !== 'object' || value === null) return { kind: 'unavailable' };
	const b = value as Record<string, unknown>;
	if (typeof b.tick !== 'number' || !Number.isInteger(b.tick)) return { kind: 'unavailable' };
	if (typeof b.rebuilding !== 'boolean') return { kind: 'unavailable' };
	if (b.band !== null && typeof b.band !== 'string') return { kind: 'unavailable' };
	if (!Array.isArray(b.signals)) return { kind: 'unavailable' };

	const signals = [];
	for (const s of b.signals) {
		if (typeof s !== 'object' || s === null) return { kind: 'unavailable' };
		const r = s as Record<string, unknown>;
		if (typeof r.signal !== 'string') return { kind: 'unavailable' };
		signals.push({
			signal: r.signal,
			corroborated: r.corroborated === true,
			marshal_verified: r.marshal_verified === true
		});
	}
	return {
		kind: 'board',
		tick: b.tick,
		rebuilding: b.rebuilding,
		band: (b.band as string | null) ?? null,
		signals
	};
}
