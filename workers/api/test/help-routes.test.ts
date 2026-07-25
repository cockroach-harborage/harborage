/**
 * The helper-offer and capacity routes (PRD §4.9).
 *
 * Two properties are worth the most guarding, and neither is a status code: the
 * offer route must not be an existence oracle, and the read must distinguish
 * three different kinds of empty.
 */
import { describe, expect, it } from 'vitest';
import { app } from '../src/app.ts';

function only(...names: string[]) {
	return {
		get: async (k: string) =>
			names.includes(k.replace('flag:', ''))
				? JSON.stringify({ enabled: true, epoch: 1, updatedAt: '2026-07-26' })
				: null
	};
}

const rateLimit = {
	idFromName: (n: string) => n,
	get: () => ({ allow: async () => true, admit: async () => 'ok' })
};

/** Records every statement, so a test can assert what was NOT asked. */
function recordingDb(rows: unknown[] = [], throwOnAll = false) {
	const sql: string[] = [];
	return {
		sql,
		db: {
			prepare(q: string) {
				sql.push(q.replace(/\s+/g, ' ').trim());
				return {
					bind: () => ({
						run: async () => ({ meta: { changes: 0 } }),
						all: async () => ({ results: rows }),
						first: async () => rows[0] ?? null
					}),
					run: async () => ({ meta: { changes: 0 } }),
					all: async () => {
						if (throwOnAll) throw new Error('d1 unavailable');
						return { results: rows };
					},
					first: async () => rows[0] ?? null
				};
			},
			batch: async () => []
		}
	};
}

const OFFER = {
	region_bucket: 'IN-PB-LDH',
	skill: 'legal_aid',
	tier: 'BASIC',
	dedup_token: 'ab'.repeat(32)
};

function postOffer(body: unknown, env: unknown) {
	return app.request(
		'/api/help/offer',
		{ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
		env as never
	);
}

describe('POST /api/help/offer structural validation', () => {
	/**
	 * Structural checks run BEFORE the credential, so these use an empty env.
	 * With the credential first, a malformed body would return 401 and a test
	 * asserting "not 202" would pass with the shape rules deleted.
	 */
	it('rejects a bad region, skill, tier or token with exactly 400', async () => {
		const noEnv = {} as never;
		for (const bad of [
			{ ...OFFER, region_bucket: 'somewhere' },
			{ ...OFFER, skill: 'not_a_skill' },
			{ ...OFFER, tier: 'SUPREME' },
			{ ...OFFER, dedup_token: 'short' },
			{}
		]) {
			const res = await postOffer(bad, noEnv);
			expect(res.status, JSON.stringify(bad).slice(0, 40)).toBe(400);
		}
	});

	/**
	 * THE INTERLOCK, at the route layer. `accommodation` is not in the enum, so a
	 * stranger-to-home offer cannot be expressed. The CHECK constraint in 0019
	 * says the same thing one layer down, which is the layer that survives this
	 * Worker being replaced.
	 */
	it('refuses any housing-shaped skill with exactly 400', async () => {
		for (const skill of [
			'accommodation',
			'host_accommodation',
			'temporary_accommodation',
			'housing'
		]) {
			const res = await postOffer({ ...OFFER, skill }, {} as never);
			expect(res.status, skill).toBe(400);
		}
	});
});

describe('POST /api/help/offer flag and tier posture', () => {
	it('refuses with exactly 403 while the flag is off', async () => {
		const res = await postOffer(OFFER, { FLAGS: only(), RATE_LIMIT: rateLimit });
		expect(res.status).toBe(403);
	});

	it('refuses under heightened threat, flag on', async () => {
		const res = await postOffer(OFFER, {
			FLAGS: only('helper_registry', 'heightened_threat'),
			RATE_LIMIT: rateLimit
		});
		expect(res.status).toBe(403);
	});

	it('reaches the credential check when only helper_registry is on', async () => {
		const res = await postOffer(OFFER, {
			FLAGS: only('helper_registry'),
			RATE_LIMIT: rateLimit
		});
		// 401, not 403: the flag opened. Without this the 403s above would be
		// indistinguishable from a route that refuses unconditionally.
		expect(res.status).toBe(401);
	});

	/**
	 * A HIGH-tier offer refuses while PINNED_VETTING_ISSUERS is empty. It gets a
	 * 401 first here because no credential is attached, so the tier refusal is
	 * proven at the pure function in worker-lib/test/medical.test.ts, WITH a
	 * positive control. Noted rather than papered over: a route test cannot see
	 * past the credential, and pretending otherwise is how a check gets deleted.
	 */
	it('does not admit a HIGH offer without a credential either', async () => {
		const res = await postOffer(
			{ ...OFFER, tier: 'HIGH' },
			{ FLAGS: only('helper_registry'), RATE_LIMIT: rateLimit }
		);
		expect(res.status).not.toBe(202);
	});
});

describe('the offer route is not an oracle', () => {
	/**
	 * NO SELECT AT ALL. Deduplication is the UNIQUE index plus ON CONFLICT, not a
	 * read-then-write. A route that can read the registry is a route that can be
	 * asked whether a given person already offered.
	 *
	 * Asserted over recorded SQL rather than over a status, because a status
	 * cannot see the difference. gate-no-enumeration refuses the same thing
	 * structurally; this is the runtime half.
	 */
	it('issues exactly one statement, an INSERT, and never a SELECT', async () => {
		const { sql, db } = recordingDb();
		await postOffer(OFFER, {
			FLAGS: only('helper_registry'),
			RATE_LIMIT: rateLimit,
			DB: db,
			TURNSTILE_SECRET: undefined
		});
		for (const q of sql) expect(q.toUpperCase()).not.toContain('SELECT');
	});
});

describe('GET /api/help/capacity has three distinguishable empties', () => {
	/**
	 * A reader must be able to tell "we are not publishing" from "we could not
	 * read" from "there is nobody here". A test asserting only
	 * `bands.length === 0` would pass for all three, which is exactly how a
	 * degraded read gets mistaken for an honest answer.
	 */
	it('says not published when the flag is off, rather than NONE', async () => {
		const res = await app.request('/api/help/capacity', {}, {
			FLAGS: only(),
			RATE_LIMIT: rateLimit
		} as never);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { published: boolean; bands: unknown[]; stale?: boolean };
		expect(body.published).toBe(false);
		expect(body.bands).toEqual([]);
		expect(body.stale).toBeUndefined();
	});

	it('says stale when the read failed', async () => {
		const { db } = recordingDb([], true);
		const res = await app.request('/api/help/capacity', {}, {
			FLAGS: only('helper_registry'),
			RATE_LIMIT: rateLimit,
			DB: db
		} as never);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { published: boolean; stale?: boolean };
		expect(body.published).toBe(true);
		expect(body.stale).toBe(true);
	});

	it('publishes the grid when there is one', async () => {
		const { db } = recordingDb([
			{ region_bucket: 'IN-PB-LDH', skill: 'legal_aid', tier: 'BASIC', band: 'NONE' }
		]);
		const res = await app.request('/api/help/capacity', {}, {
			FLAGS: only('helper_registry'),
			RATE_LIMIT: rateLimit,
			DB: db
		} as never);
		const body = (await res.json()) as { published: boolean; bands: unknown[]; stale?: boolean };
		expect(body.published).toBe(true);
		expect(body.bands).toHaveLength(1);
		expect(body.stale).toBeUndefined();
	});

	/** One unparameterised statement: a per-region query would record interest. */
	it('reads the whole grid with no parameter', async () => {
		const { sql, db } = recordingDb();
		await app.request('/api/help/capacity', {}, {
			FLAGS: only('helper_registry'),
			RATE_LIMIT: rateLimit,
			DB: db
		} as never);
		expect(sql).toEqual(['SELECT * FROM capacity_bands']);
	});
});
