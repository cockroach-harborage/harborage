/**
 * GET /api/live/:zone — the read path, and mostly a suite about FAIL POSTURE.
 *
 * §6.5 splits the posture: privacy-sensitive writes fail CLOSED, safety-critical
 * hazard reads fail to LAST-CACHED-WITH-STALE, never dark. The write half is
 * live-redline.conformance.test.ts. This is the other half, and almost every
 * test here is a way the board could go dark that it must not.
 *
 * The three read shapes must stay DISTINGUISHABLE — not published, could not
 * read, nothing here — because a test asserting only `signals.length === 0`
 * passes for all three, and so does a client that renders them the same way.
 */
import { describe, expect, it } from 'vitest';
import { app } from '../src/app.ts';
import { BANDS } from '@harborage/worker-lib/liveboard';

const ZONE = 'IN-DL-z0417';

function only(...names: string[]) {
	return {
		get: async (k: string) =>
			names.includes(k.replace('flag:', ''))
				? JSON.stringify({ enabled: true, epoch: 1, updatedAt: '2026-07-26' })
				: null
	};
}

/** Refuses everything. Used to prove the read is NOT behind the ladder. */
const rateLimitClosed = {
	idFromName: (n: string) => n,
	get: () => ({ allow: async () => false, admit: async () => 'limited' })
};

function db(opts: { zone?: 'active' | 'absent' | 'throws' } = {}) {
	return {
		prepare: () => ({
			bind: () => ({
				first: async () => {
					const zone = opts.zone ?? 'active';
					if (zone === 'throws') throw new Error('d1 unavailable');
					return zone === 'active' ? { zone_id: ZONE } : null;
				}
			})
		})
	};
}

type ViewOpts = { sinceTick?: number; waitMs?: number; heightened?: boolean };

/** Records what the route asked the board for, and how often it asked at all. */
function boardNs(opts: { band?: string | null; throws?: boolean } = {}) {
	const names: string[] = [];
	const calls: ViewOpts[] = [];
	return {
		names,
		calls,
		ns: {
			idFromName(n: string) {
				names.push(n);
				return n;
			},
			get: () => ({
				view: async (o: ViewOpts) => {
					calls.push(o);
					if (opts.throws) throw new Error('do unreachable');
					return {
						tick: 4242,
						zone_id: ZONE,
						rebuilding: false,
						band: opts.band === undefined ? 'moderate' : opts.band,
						signals: [{ signal: 'TEAR_GAS', corroborated: true, marshal_verified: false }]
					};
				}
			})
		}
	};
}

function get(path: string, env: unknown) {
	return app.request(path, { method: 'GET' }, env as never);
}

function envWith(over: Record<string, unknown> = {}) {
	return {
		FLAGS: only('live_board', 'crowd_bands'),
		RATE_LIMIT: rateLimitClosed,
		DB: db(),
		LIVE_BOARD: boardNs().ns,
		...over
	};
}

describe('the board never goes dark', () => {
	/**
	 * THE LOAD-BEARING ONE. There is no rate limit on this route, deliberately:
	 * broadTiersOk keys a bucket on the ASN, and every protestor on one carrier in
	 * one city shares an ASN. An ASN bucket here saturates exactly when a crackdown
	 * sends everybody to the app at once. The stub refuses every token and the read
	 * must still be served.
	 */
	it('serves the board while the rate limiter is refusing everything', async () => {
		const b = boardNs();
		const res = await get(`/api/live/${ZONE}`, envWith({ LIVE_BOARD: b.ns }));
		expect(res.status).toBe(200);
		const body = (await res.json()) as { published: boolean; board: { signals: unknown[] } };
		expect(body.published).toBe(true);
		expect(body.board.signals).toHaveLength(1);
	});

	/** No credential is minted anywhere in this file, and every read still works. */
	it('asks for no credential', async () => {
		expect((await get(`/api/live/${ZONE}`, envWith())).status).toBe(200);
	});

	/** A read failing CLOSED would be the board going dark. It fails to stale. */
	it('reports stale, not closed, when the zone lookup fails', async () => {
		const b = boardNs();
		const res = await get(
			`/api/live/${ZONE}`,
			envWith({ DB: db({ zone: 'throws' }), LIVE_BOARD: b.ns })
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ published: true, stale: true, board: null });
		expect(b.names).toHaveLength(0);
	});

	it('reports stale when the board itself is unreachable', async () => {
		const res = await get(
			`/api/live/${ZONE}`,
			envWith({ LIVE_BOARD: boardNs({ throws: true }).ns })
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ published: true, stale: true, board: null });
	});

	/**
	 * The three shapes, side by side in one test on purpose. Asserted together
	 * because the property is that they DIFFER, and three separate tests each
	 * asserting one shape would all pass if the route collapsed them into one.
	 */
	it('keeps not-published, could-not-read and nothing-here distinguishable', async () => {
		const off = await (await get(`/api/live/${ZONE}`, envWith({ FLAGS: only() }))).json();
		const broken = await (
			await get(`/api/live/${ZONE}`, envWith({ DB: db({ zone: 'throws' }) }))
		).json();
		const empty = await (
			await get(
				`/api/live/${ZONE}`,
				envWith({
					LIVE_BOARD: {
						idFromName: (n: string) => n,
						get: () => ({
							view: async () => ({
								tick: 1,
								zone_id: ZONE,
								rebuilding: true,
								band: null,
								signals: []
							})
						})
					}
				})
			)
		).json();

		expect(off).toEqual({ published: false, stale: false, board: null });
		expect(broken).toEqual({ published: true, stale: true, board: null });
		expect(empty).toMatchObject({ published: true, stale: false, board: { rebuilding: true } });
		expect(new Set([JSON.stringify(off), JSON.stringify(broken), JSON.stringify(empty)]).size).toBe(
			3
		);
	});

	/** Off is not a claim about the ground. It creates no board either. */
	it('creates no board instance while the flag is off', async () => {
		const b = boardNs();
		await get(`/api/live/${ZONE}`, envWith({ FLAGS: only(), LIVE_BOARD: b.ns }));
		expect(b.names).toHaveLength(0);
	});
});

describe('heightened threat tightens the read, it does not close it', () => {
	/** §6.5: heightened threat must never blind people to TEAR_GAS. */
	it('still serves hazard signals under heightened threat', async () => {
		const res = await get(
			`/api/live/${ZONE}`,
			envWith({ FLAGS: only('live_board', 'crowd_bands', 'heightened_threat') })
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { board: { signals: unknown[] } };
		expect(body.board.signals).toHaveLength(1);
	});

	/**
	 * The posture must reach the DO, because that is where the thresholds live.
	 * Asserting only the null band would pass with `heightened` never forwarded:
	 * the Worker nulls the band on its own.
	 */
	it('forwards the posture to the board, not just the band decision', async () => {
		const b = boardNs();
		await get(
			`/api/live/${ZONE}`,
			envWith({
				FLAGS: only('live_board', 'crowd_bands', 'heightened_threat'),
				LIVE_BOARD: b.ns
			})
		);
		expect(b.calls[0]?.heightened).toBe(true);

		const plain = boardNs();
		await get(`/api/live/${ZONE}`, envWith({ LIVE_BOARD: plain.ns }));
		expect(plain.calls[0]?.heightened).toBe(false);
	});

	/** §6.4: bands go away ENTIRELY under heightened threat. */
	it('nulls the band under heightened threat even when the board returns one', async () => {
		const res = await get(
			`/api/live/${ZONE}`,
			envWith({
				FLAGS: only('live_board', 'crowd_bands', 'heightened_threat'),
				LIVE_BOARD: boardNs({ band: 'large' }).ns
			})
		);
		const body = (await res.json()) as { board: { band: string | null } };
		expect(body.board.band).toBeNull();
	});

	/**
	 * Two independent conditions, and this is the second. The DO cannot read KV, so
	 * it has no way to know crowd_bands is off; the Worker nulls it. Without this
	 * test, deleting the Worker-side null goes unnoticed because the DO's own
	 * heightened-threat handling covers the other case.
	 */
	it('nulls the band when crowd_bands is off but the board still returns one', async () => {
		const res = await get(
			`/api/live/${ZONE}`,
			envWith({ FLAGS: only('live_board'), LIVE_BOARD: boardNs({ band: 'large' }).ns })
		);
		const body = (await res.json()) as { board: { band: string | null; signals: unknown[] } };
		expect(body.board.band).toBeNull();
		// And the hazard rows survive: crowd_bands off is not live_board off.
		expect(body.board.signals).toHaveLength(1);
	});

	/** The positive control, so "nulls the band" is not "never has a band". */
	it('returns a band from the pinned vocabulary when both flags are on', async () => {
		const res = await get(`/api/live/${ZONE}`, envWith());
		const body = (await res.json()) as { board: { band: string } };
		expect(BANDS).toContain(body.board.band);
	});
});

describe('the zone is a name on a signed list', () => {
	it('refuses a malformed or geohash-shaped zone with exactly 400', async () => {
		for (const z of ['IN-DL-tuvz9k', 'ttnfv2u', 'IN-DL', 'IN-DL-28.61-77.20', 'IN-DL-z0417x']) {
			expect((await get(`/api/live/${z}`, envWith())).status, z).toBe(400);
		}
	});

	/**
	 * 404, and it leaks nothing: the zone list is public, signed, and shipped in
	 * the offline pack. It tells a client something actionable — its copy of the
	 * list is out of date — which "empty board" would not.
	 */
	it('returns 404 for a well-formed zone that is not active, creating no board', async () => {
		const b = boardNs();
		const res = await get(
			`/api/live/${ZONE}`,
			envWith({ DB: db({ zone: 'absent' }), LIVE_BOARD: b.ns })
		);
		expect(res.status).toBe(404);
		expect(b.names).toHaveLength(0);
	});

	it('addresses one board per zone, by name', async () => {
		const b = boardNs();
		await get(`/api/live/${ZONE}`, envWith({ LIVE_BOARD: b.ns }));
		expect(b.names).toEqual(['zone:' + ZONE]);
	});
});

describe('the long poll is clamped and the response is not cacheable', () => {
	it('clamps wait to the ceiling', async () => {
		const b = boardNs();
		await get(`/api/live/${ZONE}?wait=600000`, envWith({ LIVE_BOARD: b.ns }));
		expect(b.calls[0]?.waitMs).toBe(25_000);
	});

	it('treats a negative or unparseable wait as no wait', async () => {
		for (const q of ['wait=-5000', 'wait=abc', 'wait=', '']) {
			const b = boardNs();
			await get(`/api/live/${ZONE}?${q}`, envWith({ LIVE_BOARD: b.ns }));
			expect(b.calls[0]?.waitMs, q).toBe(0);
		}
	});

	it('passes since through, and omits it when absent', async () => {
		const withSince = boardNs();
		await get(`/api/live/${ZONE}?since=99`, envWith({ LIVE_BOARD: withSince.ns }));
		expect(withSince.calls[0]?.sinceTick).toBe(99);

		const without = boardNs();
		await get(`/api/live/${ZONE}`, envWith({ LIVE_BOARD: without.ns }));
		expect(without.calls[0]).not.toHaveProperty('sinceTick');
	});

	/**
	 * A cached board is a stale board served as fresh, and the staleness contract
	 * lives in the client, which needs the tick to evaluate it.
	 */
	it('sends no-store and the tick header', async () => {
		const res = await get(`/api/live/${ZONE}`, envWith());
		expect(res.headers.get('cache-control')).toBe('no-store');
		expect(res.headers.get('x-hb-tick')).toBe('4242');
	});

	/** Every refusal shape is no-store too, or a CDN caches "not published". */
	it('sends no-store on the flag-off and stale shapes as well', async () => {
		for (const env of [envWith({ FLAGS: only() }), envWith({ DB: db({ zone: 'throws' }) })]) {
			expect((await get(`/api/live/${ZONE}`, env)).headers.get('cache-control')).toBe('no-store');
		}
	});
});

describe('the response carries no count and no coordinate', () => {
	it('has no numeric field beyond the tick', async () => {
		const text = await (await get(`/api/live/${ZONE}`, envWith())).text();
		expect(text).not.toMatch(/"(count|reporters?|density|n|total|people)"\s*:/i);
		expect(text).not.toMatch(/"(lat|lng|latitude|longitude|geohash|coords|accuracy)\w*"\s*:/i);
		// first_seen or expires_at would be a timing channel back to the report time.
		expect(text).not.toMatch(/"(first_seen|firstSeen|expires|reported_at)\w*"\s*:/i);
	});
});

describe('GET /api/live/zones serves the list, and does not vouch for it', () => {
	function zonesDb(rows: unknown[] | 'throws') {
		return {
			prepare: () => ({
				all: async () => {
					if (rows === 'throws') throw new Error('d1 unavailable');
					return { results: rows };
				},
				bind: () => ({ first: async () => null })
			})
		};
	}

	const ROW = {
		zone_id: ZONE,
		region_bucket: 'IN-DL',
		label_key: 'zone.delhi.north.gate',
		list_epoch: 4,
		list_signature: '[{"key_id":"p1","sig":"AAAA"}]'
	};

	/** Zero rows is the resting state, and it is not an error. */
	it('returns an empty list rather than an error when no zone is active', async () => {
		const res = await get('/api/live/zones', envWith({ DB: zonesDb([]) }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ list_epoch: 0, zones: [], signatures: [] });
	});

	it('returns the rows with their signatures', async () => {
		const res = await get('/api/live/zones', envWith({ DB: zonesDb([ROW]) }));
		expect(await res.json()).toEqual({
			list_epoch: 4,
			zones: [{ zone_id: ZONE, region_bucket: 'IN-DL', label_key: 'zone.delhi.north.gate' }],
			signatures: [{ key_id: 'p1', sig: 'AAAA' }]
		});
	});

	/**
	 * A zone row carries no coordinate, and the response carries no column the
	 * client did not ask for. list_signature is folded into `signatures`; nothing
	 * else from the row reaches the wire.
	 */
	it('emits only the three zone fields', async () => {
		const res = await get('/api/live/zones', envWith({ DB: zonesDb([ROW]) }));
		const body = (await res.json()) as { zones: Record<string, unknown>[] };
		expect(Object.keys(body.zones[0] ?? {}).sort()).toEqual([
			'label_key',
			'region_bucket',
			'zone_id'
		]);
	});

	/**
	 * Rows disagreeing about the epoch is a HALF-APPLIED publish, and half a signed
	 * list is a list whose contents nobody signed. Refused as a whole, not filtered:
	 * filtering would leave the subset an attacker chose.
	 */
	it('serves nothing when the rows disagree about the epoch', async () => {
		const res = await get(
			'/api/live/zones',
			envWith({ DB: zonesDb([ROW, { ...ROW, zone_id: 'IN-DL-z0418', list_epoch: 5 }]) })
		);
		expect(await res.json()).toEqual({ list_epoch: 0, zones: [], signatures: [] });
	});

	it('serves an empty list, never a partial one, when the read fails', async () => {
		const res = await get('/api/live/zones', envWith({ DB: zonesDb('throws') }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ list_epoch: 0, zones: [], signatures: [] });
	});

	/** Served while live_board is off: the list is a map, not a feed. */
	it('serves the list while live_board is off', async () => {
		const res = await get('/api/live/zones', envWith({ FLAGS: only(), DB: zonesDb([ROW]) }));
		expect(res.status).toBe(200);
		expect(((await res.json()) as { zones: unknown[] }).zones).toHaveLength(1);
	});
});

describe('GET /api/accountability/records', () => {
	function acctDb(rows: unknown[] | 'throws') {
		return {
			prepare: () => ({
				all: async () => {
					if (rows === 'throws') throw new Error('d1 unavailable');
					return { results: rows };
				},
				bind: () => ({ first: async () => null })
			})
		};
	}

	const ROW = {
		id: 'acct_1',
		station_code: 'PS-DL-0042',
		unit_code: null,
		rank_band: 'inspector_band',
		shift_bucket: 'night',
		region_bucket: 'IN-DL',
		incident_ref: 'inc_1',
		documentary_anchor_sha256: 'c'.repeat(64),
		official_name: 'Someone',
		official_badge: 'B-1',
		right_of_reply_ref: 'ror_1',
		corroboration_count: 4,
		directory_epoch: 5,
		record_hash: 'a'.repeat(64),
		quorum_bundle: '[]'
	};

	/** The flag is off today, and off is not a claim that there are no records. */
	it('says not published while the flag is off, and reads nothing', async () => {
		let queried = false;
		const res = await get('/api/accountability/records', {
			FLAGS: only(),
			RATE_LIMIT: rateLimitClosed,
			DB: {
				prepare: () => {
					queried = true;
					return { all: async () => ({ results: [] }) };
				}
			}
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ published: false, records: [] });
		expect(queried, 'flag-off must not touch D1').toBe(false);
	});

	/**
	 * PUBLISHED only. Belt to migration 0022's braces: the CHECK already makes an
	 * individual identifier impossible outside a PUBLISHED row, so this filter and
	 * that constraint say the same thing — and the CHECK is the half that survives a
	 * compelled edit to the Worker.
	 */
	it('asks only for published rows', async () => {
		let sql = '';
		await get('/api/accountability/records', {
			FLAGS: only('accountability_records'),
			RATE_LIMIT: rateLimitClosed,
			DB: {
				prepare: (q: string) => {
					sql = q;
					return { all: async () => ({ results: [] }) };
				}
			}
		});
		expect(sql).toMatch(/WHERE\s+status\s*=\s*'PUBLISHED'/i);
	});

	/**
	 * The name IS served, and that is the design: the reader verifies, and it cannot
	 * verify what it was not sent. The bundle, the canonical hash and the directory
	 * epoch travel with it so the device can re-derive and re-check.
	 */
	it('serves the identifier together with everything needed to check it', async () => {
		const res = await get('/api/accountability/records', {
			FLAGS: only('accountability_records'),
			RATE_LIMIT: rateLimitClosed,
			DB: acctDb([ROW])
		});
		const body = (await res.json()) as { records: Record<string, unknown>[] };
		const r = body.records[0] ?? {};
		for (const k of ['official_name', 'record_hash', 'quorum_bundle', 'directory_epoch'])
			expect(Object.keys(r), k).toContain(k);
	});

	/** No private-life column can be served, because none is selected. */
	it('selects no private-life column', async () => {
		let sql = '';
		await get('/api/accountability/records', {
			FLAGS: only('accountability_records'),
			RATE_LIMIT: rateLimitClosed,
			DB: {
				prepare: (q: string) => {
					sql = q;
					return { all: async () => ({ results: [] }) };
				}
			}
		});
		expect(sql).not.toMatch(/home|family|address|phone|personal|social|photo|plate/i);
		expect(sql).not.toMatch(/SELECT\s+\*/i);
	});

	/** Three distinguishable shapes, as everywhere else. */
	it('keeps not-published, could-not-read and nothing-here distinguishable', async () => {
		const off = await (
			await get('/api/accountability/records', { FLAGS: only(), RATE_LIMIT: rateLimitClosed })
		).json();
		const broken = await (
			await get('/api/accountability/records', {
				FLAGS: only('accountability_records'),
				RATE_LIMIT: rateLimitClosed,
				DB: acctDb('throws')
			})
		).json();
		const empty = await (
			await get('/api/accountability/records', {
				FLAGS: only('accountability_records'),
				RATE_LIMIT: rateLimitClosed,
				DB: acctDb([])
			})
		).json();
		expect(off).toEqual({ published: false, records: [] });
		expect(broken).toEqual({ published: true, records: [], stale: true });
		expect(empty).toEqual({ published: true, records: [] });
		expect(new Set([JSON.stringify(off), JSON.stringify(broken), JSON.stringify(empty)]).size).toBe(
			3
		);
	});
});
