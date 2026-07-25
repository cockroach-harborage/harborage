/**
 * The client half of "never dark".
 *
 * The server can only decline to answer. Whether the user still sees the last
 * known hazards is decided in liveboard-cache.ts, so most of this file is about
 * one branch: an EMPTY board must not silently replace a non-empty one while the
 * board says it is rebuilding.
 */
import { describe, expect, it } from 'vitest';
import { SIGNAL_TTL_MS, TICK_MS } from '@harborage/worker-lib/liveboard';
import {
	CACHE_MAX_AGE_MS,
	isAged,
	present,
	reconcile,
	STALE_AFTER_TICKS,
	type BoardSnapshot,
	type FetchOutcome
} from '../src/lib/liveboard-cache.ts';
import {
	fetchBoard,
	HEARTBEAT_BASE_MS,
	HEARTBEAT_JITTER_MS,
	HEARTBEAT_MAX_MS,
	heartbeatExpired,
	nextHeartbeatMs,
	READ_WAIT_MS,
	shouldHeartbeat
} from '../src/lib/liveboard-client.ts';
import {
	EMPTY_ZONE_STATE,
	PINNED_ZONE_PUBLISHERS,
	verifyFetchedZones,
	zonesForRegion,
	ZONE_LIST_MIN_KEYS,
	ZONE_LIST_REQUIRED
} from '../src/lib/liveboard-zones.ts';

const ZONE = 'IN-DL-z0417';
const NOW = 1_785_000_000_000;
const TEAR_GAS = [{ signal: 'TEAR_GAS', corroborated: true, marshal_verified: false }];

function snap(over: Partial<BoardSnapshot> = {}): BoardSnapshot {
	return {
		zone_id: ZONE,
		tick: Math.floor(NOW / TICK_MS),
		band: 'moderate',
		signals: TEAR_GAS,
		storedAtMs: NOW,
		...over
	};
}

function board(over: Partial<Extract<FetchOutcome, { kind: 'board' }>> = {}): FetchOutcome {
	return {
		kind: 'board',
		tick: Math.floor(NOW / TICK_MS),
		rebuilding: false,
		band: 'moderate',
		signals: TEAR_GAS,
		...over
	};
}

describe('an empty board never silently clears a hazard row', () => {
	/**
	 * THE ONE THAT MATTERS. After a Durable Object eviction the board comes back
	 * empty, and empty is indistinguishable from "no hazards here". Trusting it
	 * would clear a tear-gas row off the screen at the moment the person reading it
	 * is deciding which way to walk.
	 */
	it('keeps the cached rows when a rebuilding board comes back empty', () => {
		const p = reconcile(snap(), board({ rebuilding: true, signals: [] }), ZONE, NOW);
		expect(p.snapshot?.signals).toEqual(TEAR_GAS);
		expect(p.stale).toBe(true);
		expect(p.blank).toBe(false);
	});

	/**
	 * THE COUNTERPART, and without it the rule above would just be "never update".
	 * A settled board saying there is nothing here IS an answer, and it is the one
	 * path that clears rows.
	 */
	it('clears the rows when a settled board comes back empty', () => {
		const p = reconcile(snap(), board({ rebuilding: false, signals: [] }), ZONE, NOW);
		expect(p.snapshot?.signals).toEqual([]);
		expect(p.stale).toBe(false);
	});

	/** A rebuilding board that has signals is worth showing, and still incomplete. */
	it('shows a rebuilding board that already has signals, badged stale', () => {
		const p = reconcile(null, board({ rebuilding: true }), ZONE, NOW);
		expect(p.snapshot?.signals).toEqual(TEAR_GAS);
		expect(p.stale).toBe(true);
	});

	it('keeps the cached rows when the read is unavailable', () => {
		const p = reconcile(snap(), { kind: 'unavailable' }, ZONE, NOW);
		expect(p.snapshot?.signals).toEqual(TEAR_GAS);
		expect(p.stale).toBe(true);
		expect(p.blank).toBe(false);
	});

	/**
	 * Nothing cached and nothing served is BLANK, which the surface must say in
	 * words. An empty signal list rendered as an empty list reads as "no hazards",
	 * and that is a claim nobody made.
	 */
	it('reports blank when there is no cache and nothing was served', () => {
		const p = reconcile(null, { kind: 'unavailable' }, ZONE, NOW);
		expect(p.snapshot).toBeNull();
		expect(p.blank).toBe(true);
	});
});

describe('a cached snapshot has a hard expiry', () => {
	/**
	 * Showing a hazard for longer than the board itself would have kept it is not
	 * caution, it is a lie with a badge on it. The bound is the board's own TTL.
	 */
	it('drops a snapshot older than the signal TTL', () => {
		expect(CACHE_MAX_AGE_MS).toBe(SIGNAL_TTL_MS);
		const old = snap({ storedAtMs: NOW - CACHE_MAX_AGE_MS - 1 });
		const p = reconcile(old, { kind: 'unavailable' }, ZONE, NOW);
		expect(p.snapshot).toBeNull();
		expect(p.blank).toBe(true);
	});

	it('keeps a snapshot exactly at the boundary', () => {
		const edge = snap({ storedAtMs: NOW - CACHE_MAX_AGE_MS });
		expect(reconcile(edge, { kind: 'unavailable' }, ZONE, NOW).snapshot).not.toBeNull();
	});

	/**
	 * A cache from another zone is not a fallback for this one. Showing Ludhiana's
	 * tear gas on Delhi's board is worse than showing nothing.
	 */
	it('never serves one zone a cache from another', () => {
		const other = snap({ zone_id: 'IN-PB-LDH-z0002' });
		const p = reconcile(other, { kind: 'unavailable' }, ZONE, NOW);
		expect(p.snapshot).toBeNull();
		expect(p.blank).toBe(true);
	});
});

describe('staleness also comes from the passage of time', () => {
	/**
	 * A badge that only appeared on a failed request would be absent exactly when
	 * nothing is being requested — a backgrounded tab, a dead network, a phone in a
	 * pocket.
	 */
	it('ages a snapshot past the tick allowance with no fetch involved', () => {
		const fresh = snap();
		expect(isAged(fresh, NOW)).toBe(false);
		expect(isAged(fresh, NOW + STALE_AFTER_TICKS * TICK_MS)).toBe(false);
		expect(isAged(fresh, NOW + (STALE_AFTER_TICKS + 1) * TICK_MS)).toBe(true);
	});

	it('treats no snapshot as aged', () => {
		expect(isAged(null, NOW)).toBe(true);
	});

	/** present() folds both sources, so a surface cannot read one and miss the other. */
	it('marks a freshly-served board stale once its tick is old', () => {
		const late = NOW + (STALE_AFTER_TICKS + 1) * TICK_MS;
		const p = present(null, board(), ZONE, late);
		expect(p.snapshot?.signals).toEqual(TEAR_GAS);
		expect(p.stale).toBe(true);
	});
});

describe('the heartbeat', () => {
	/** 45 s sits under the 70 s eviction floor, and the jitter must not cross it. */
	it('stays under the eviction floor at both extremes', () => {
		expect(nextHeartbeatMs(() => 0)).toBe(HEARTBEAT_BASE_MS - HEARTBEAT_JITTER_MS);
		expect(nextHeartbeatMs(() => 1)).toBe(HEARTBEAT_BASE_MS + HEARTBEAT_JITTER_MS);
		// 70_000 is the low end of the documented Durable Object eviction window.
		expect(HEARTBEAT_BASE_MS + HEARTBEAT_JITTER_MS).toBeLessThan(70_000);
	});

	/**
	 * Symmetric, and the asymmetric version is the bug this catches: a one-sided
	 * jitter pushes the mean above the floor and the board dies between beats for
	 * the slowest clients.
	 */
	it('is symmetric about the base', () => {
		expect(nextHeartbeatMs(() => 0.5)).toBe(HEARTBEAT_BASE_MS);
		const lo = nextHeartbeatMs(() => 0);
		const hi = nextHeartbeatMs(() => 1);
		expect(HEARTBEAT_BASE_MS - lo).toBe(hi - HEARTBEAT_BASE_MS);
	});

	/** A hidden tab reporting is a reporter who is not there. */
	it('does not beat while the tab is hidden', () => {
		expect(shouldHeartbeat({ visible: false, startedAtMs: NOW, nowMs: NOW })).toBe(false);
		expect(shouldHeartbeat({ visible: true, startedAtMs: NOW, nowMs: NOW })).toBe(true);
	});

	/** A tab left open on a desk must stop reporting. */
	it('stops after the session ceiling', () => {
		expect(heartbeatExpired(NOW, NOW + HEARTBEAT_MAX_MS - 1)).toBe(false);
		expect(heartbeatExpired(NOW, NOW + HEARTBEAT_MAX_MS)).toBe(true);
		expect(
			shouldHeartbeat({ visible: true, startedAtMs: NOW, nowMs: NOW + HEARTBEAT_MAX_MS })
		).toBe(false);
	});
});

describe('fetchBoard invents nothing', () => {
	function fetcher(body: unknown, ok = true, status = 200) {
		const calls: string[] = [];
		return {
			calls,
			fn: (async (url: string) => {
				calls.push(url);
				return {
					ok,
					status,
					json: async () => body
				} as unknown as Response;
			}) as unknown as typeof globalThis.fetch
		};
	}

	it('reads a well-formed board', async () => {
		const f = fetcher({
			published: true,
			stale: false,
			board: { tick: 7, rebuilding: false, band: 'small', signals: TEAR_GAS }
		});
		expect(await fetchBoard(ZONE, { fetch: f.fn })).toEqual({
			kind: 'board',
			tick: 7,
			rebuilding: false,
			band: 'small',
			signals: TEAR_GAS
		});
	});

	/**
	 * EVERY failure collapses to 'unavailable', which keeps the cache. The
	 * alternative — a partially-parsed board — would REPLACE it, and a malformed
	 * response becoming an empty board is what clears hazard rows off a screen.
	 */
	it('collapses every malformed or refused response to unavailable', async () => {
		const cases: Array<[string, unknown, boolean]> = [
			['not published', { published: false, board: null }, true],
			['server said stale', { published: true, stale: true, board: null }, true],
			['null board', { published: true, board: null }, true],
			['no tick', { published: true, board: { rebuilding: false, band: null, signals: [] } }, true],
			[
				'fractional tick',
				{ published: true, board: { tick: 1.5, rebuilding: false, band: null, signals: [] } },
				true
			],
			[
				'rebuilding missing',
				{ published: true, board: { tick: 1, band: null, signals: [] } },
				true
			],
			[
				'band is a number',
				{ published: true, board: { tick: 1, rebuilding: false, band: 3, signals: [] } },
				true
			],
			[
				'signals not an array',
				{ published: true, board: { tick: 1, rebuilding: false, band: null, signals: {} } },
				true
			],
			[
				'signal row is not an object',
				{ published: true, board: { tick: 1, rebuilding: false, band: null, signals: ['x'] } },
				true
			],
			['non-200', { published: true, board: board() }, false]
		];
		for (const [name, body, ok] of cases) {
			const f = fetcher(body, ok, ok ? 200 : 503);
			expect((await fetchBoard(ZONE, { fetch: f.fn })).kind, name).toBe('unavailable');
		}
	});

	it('collapses a thrown fetch to unavailable', async () => {
		const throwing = (async () => {
			throw new Error('offline');
		}) as unknown as typeof globalThis.fetch;
		expect((await fetchBoard(ZONE, { fetch: throwing })).kind).toBe('unavailable');
	});

	/**
	 * A zone id is a Durable Object instance name. Refusing locally means a
	 * malformed one never becomes a request, so it cannot ask the edge to create a
	 * namespace entry of the caller's choosing.
	 */
	it('refuses a malformed zone without making a request', async () => {
		for (const bad of ['IN-DL-tuvz9k', 'ttnfv2u', '../../etc', '', 'IN-DL']) {
			const f = fetcher({ published: true, board: board() });
			expect((await fetchBoard(bad, { fetch: f.fn })).kind, bad).toBe('unavailable');
			expect(f.calls, bad).toHaveLength(0);
		}
	});

	it('clamps the wait it asks for', async () => {
		const f = fetcher({ published: true, board: board() });
		await fetchBoard(ZONE, { fetch: f.fn, waitMs: 600_000 });
		expect(f.calls[0]).toContain(`wait=${READ_WAIT_MS}`);
	});

	it('omits since when it has none', async () => {
		const f = fetcher({ published: true, board: board() });
		await fetchBoard(ZONE, { fetch: f.fn });
		expect(f.calls[0]).not.toContain('since=');
	});

	/** No coordinate, no identifier, and no session token in the request line. */
	it('sends a URL carrying only the zone, the wait and the tick', async () => {
		const f = fetcher({ published: true, board: board() });
		await fetchBoard(ZONE, { fetch: f.fn, sinceTick: 12, waitMs: 5000 });
		expect(f.calls[0]).toBe(`/api/live/${ZONE}?wait=5000&since=12`);
	});
});

describe('the zone list is verified on the device', () => {
	/**
	 * THE RESTING STATE. No publisher is pinned, so no list verifies and no board is
	 * addressable. Switch-on needs the offline key ceremony, which no code path can
	 * substitute for.
	 */
	it('pins no publishers, so a signed list still does not verify', async () => {
		expect(PINNED_ZONE_PUBLISHERS).toHaveLength(0);
		const state = await verifyFetchedZones(
			{
				list_epoch: 4,
				zones: [{ zone_id: ZONE, region_bucket: 'IN-DL', label_key: 'zone.delhi.north.gate' }],
				signatures: [{ key_id: 'p1', sig: 'AAAA' }]
			},
			0
		);
		expect(state.reason).toBe('unverified');
		expect(state.zones).toEqual([]);
	});

	/** ≥2-of-≥3: the n floor is the half a signature count alone does not give. */
	it('demands distinct keys as well as a count', () => {
		expect(ZONE_LIST_REQUIRED).toBe(2);
		expect(ZONE_LIST_MIN_KEYS).toBeGreaterThanOrEqual(3);
	});

	/**
	 * An empty list is a legitimate answer needing no quorum — there is nothing to
	 * attest to. Reporting 'unverified' here would tell a user their app is broken
	 * when in fact no zones are published yet.
	 */
	it('separates "none listed" from "could not verify"', async () => {
		const none = await verifyFetchedZones({ list_epoch: 0, zones: [], signatures: [] }, 0);
		expect(none.reason).toBe('none-listed');
		expect(EMPTY_ZONE_STATE.reason).toBe('none-listed');
	});

	/** A malformed response is the network misbehaving, not someone lying. */
	it('separates a malformed response from a failed quorum', async () => {
		for (const bad of [
			null,
			'x',
			{},
			{ list_epoch: 1 },
			{ list_epoch: 1.5, zones: [], signatures: [] }
		]) {
			expect((await verifyFetchedZones(bad, 0)).reason, JSON.stringify(bad)).toBe('unreachable');
		}
	});

	/**
	 * A zone entry carries THREE fields. An extra one is a field nobody decided was
	 * safe to render, and on this object the field somebody will add is a coordinate.
	 */
	it('refuses a zone entry carrying an extra field', async () => {
		const withCoord = {
			list_epoch: 4,
			zones: [{ zone_id: ZONE, region_bucket: 'IN-DL', label_key: 'z', lat: 28.61 }],
			signatures: []
		};
		expect((await verifyFetchedZones(withCoord, 0)).reason).toBe('unreachable');
	});

	/** The epoch floor never decreases, which is what stops a replayed old list. */
	it('carries the floor epoch through every failure', async () => {
		expect((await verifyFetchedZones(null, 9)).epoch).toBe(9);
		expect((await verifyFetchedZones({ list_epoch: 0, zones: [], signatures: [] }, 9)).epoch).toBe(
			9
		);
	});

	/**
	 * THE ROLLBACK DEFENCE, and it must not depend on the quorum passing. An old
	 * list is PERFECTLY SIGNED, so without a floor a compelled edge could re-enable
	 * a withdrawn zone by replaying last week's list.
	 *
	 * This test exists because sabotaging the floor handed to verifyZoneList left
	 * every test green: with no publisher pinned the quorum fails first and the
	 * floor is never consulted. The check was hoisted above the quorum so the
	 * property holds today and not only on the day publishers are pinned.
	 */
	it('refuses a list from below the floor before consulting the quorum', async () => {
		const replayed = {
			list_epoch: 2,
			zones: [{ zone_id: ZONE, region_bucket: 'IN-DL', label_key: 'zone.delhi.north.gate' }],
			signatures: [{ key_id: 'p1', sig: 'AAAA' }]
		};
		const state = await verifyFetchedZones(replayed, 5);
		// 'rolled-back', NOT 'unverified'. Its own reason is what makes the check
		// observable: with no publisher pinned the quorum also fails, so sharing a
		// word with it means no test can tell which one fired.
		expect(state.reason).toBe('rolled-back');
		expect(state.zones).toEqual([]);
		expect(state.epoch).toBe(5);

		// The control: the same list at or above the floor gets past this check and
		// is stopped by the quorum instead.
		expect((await verifyFetchedZones({ ...replayed, list_epoch: 5 }, 5)).reason).toBe('unverified');
	});

	it('filters by region bucket, the only selector the client has', () => {
		const state = {
			epoch: 1,
			reason: 'ok' as const,
			zones: [
				{ zone_id: ZONE, region_bucket: 'IN-DL', label_key: 'a' },
				{ zone_id: 'IN-PB-LDH-z0002', region_bucket: 'IN-PB-LDH', label_key: 'b' }
			]
		};
		expect(zonesForRegion(state, 'IN-DL').map((z) => z.zone_id)).toEqual([ZONE]);
		expect(zonesForRegion(state, 'IN-KA')).toEqual([]);
	});
});
