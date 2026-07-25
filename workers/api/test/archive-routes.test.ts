/**
 * The archive routes (ARCHITECTURE §16).
 *
 * The property worth the most guarding is what the dedup route CANNOT be asked.
 * Every test here runs with the flag off or with a stub env, so nothing touches
 * a real binding.
 */
import { describe, expect, it } from 'vitest';
import { app, sweepProbation } from '../src/app.ts';

/** A KV stub whose flag reads all answer the same way. */
function flags(enabled: boolean) {
	return {
		get: async () =>
			enabled ? JSON.stringify({ enabled: true, epoch: 1, updatedAt: '2026-07-25' }) : null
	};
}

/** RateLimit DO stub that always admits, so the ladder is never the reason. */
const rateLimit = {
	idFromName: (n: string) => n,
	get: () => ({ allow: async () => true, admit: async () => 'ok' })
};

function env(over: Record<string, unknown> = {}) {
	return { FLAGS: flags(false), RATE_LIMIT: rateLimit, ...over } as never;
}

async function post(path: string, body: unknown, e: unknown) {
	return app.request(
		path,
		{ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
		e as never
	);
}

describe('the dedup route cannot be asked about a sealed original', () => {
	it('has no request shape that names an original digest', async () => {
		// An extra key is a question we never agreed to answer. Ignoring it is how
		// a wider question sneaks in, so the body shape is exact rather than a
		// superset.
		const res = await post(
			'/api/archive/dedup',
			{ derivative_sha256: 'd'.repeat(64), original_sha256: 'o'.repeat(64) },
			env({ FLAGS: flags(true) })
		);
		// 400 specifically, not merely "not 200". Asserting "not 200" passed even
		// with the shape rule deleted, because the request then failed the
		// credential check instead and returned 401 -- green for the wrong reason.
		expect(res.status).toBe(400);
	});

	it('refuses a body that names only an original digest', async () => {
		const res = await post(
			'/api/archive/dedup',
			{ original_sha256: 'o'.repeat(64) },
			env({ FLAGS: flags(true) })
		);
		expect(res.status).toBe(400);
	});

	it('refuses a malformed derivative digest', async () => {
		const res = await post('/api/archive/dedup', { derivative_sha256: 'nope' }, env({ FLAGS: flags(true) }));
		expect(res.status).toBe(400);
	});
});

describe('every archive route is closed while the flag is off', () => {
	for (const [path, body] of [
		['/api/archive/dedup', { derivative_sha256: 'd'.repeat(64) }],
		['/api/archive/dispute', { original_sha256: 'a'.repeat(64), reason_code: 'staged' }]
	] as const) {
		it(`${path} refuses with 403`, async () => {
			const res = await post(path, body, env());
			expect(res.status).toBe(403);
		});
	}

	it('the export refuses with 403', async () => {
		const res = await app.request(`/api/archive/export/${'a'.repeat(64)}`, {}, env());
		expect(res.status).toBe(403);
	});
});

describe('input validation', () => {
	it('refuses a bad anchor on the custody read before touching a binding', async () => {
		const res = await app.request('/api/archive/custody/not-a-digest', {}, env());
		expect(res.status).toBe(400);
	});

	it('refuses a bad anchor on the export before checking the flag', async () => {
		const res = await app.request('/api/archive/export/not-a-digest', {}, env());
		expect(res.status).toBe(400);
	});

	it('refuses a dispute reason outside the closed vocabulary', async () => {
		const res = await post(
			'/api/archive/dispute',
			{ original_sha256: 'a'.repeat(64), reason_code: 'he is a police officer named X' },
			env({ FLAGS: flags(true) })
		);
		expect(res.status).not.toBe(202);
	});
});

describe('the probation sweep', () => {
	/** A D1 stub that records what was written. */
	function db(rows: Record<string, unknown>[], openDisputes = 0) {
		const updates: unknown[][] = [];
		return {
			updates,
			binding: {
				prepare(sql: string) {
					return {
						bind(...args: unknown[]) {
							return {
								async all() {
									return { results: rows };
								},
								async first() {
									return { n: openDisputes };
								},
								async run() {
									if (/UPDATE archive_items/i.test(sql)) updates.push(args);
									return {};
								}
							};
						}
					};
				}
			}
		};
	}

	it('clears an item whose window elapsed with nothing found', async () => {
		const d = db([{ original_sha256: 'a'.repeat(64), created_bucket: '2026-01-01', rescan_count: 0 }]);
		await sweepProbation({ DB: d.binding } as never, '2026-06-01');
		expect(d.updates[0]![0]).toBe('CLEARED');
	});

	it('does not clear an item before its window elapses', async () => {
		const d = db([{ original_sha256: 'a'.repeat(64), created_bucket: '2026-01-01', rescan_count: 0 }]);
		await sweepProbation({ DB: d.binding } as never, '2026-02-01');
		expect(d.updates[0]![0]).toBe('OPEN');
	});

	it('does not clear an item with an open objection, whatever the clock says', async () => {
		const d = db(
			[{ original_sha256: 'a'.repeat(64), created_bucket: '2026-01-01', rescan_count: 0 }],
			1
		);
		await sweepProbation({ DB: d.binding } as never, '2027-01-01');
		expect(d.updates[0]![0]).toBe('OPEN');
	});

	it('deletes nothing, whatever the outcome', async () => {
		// The sweep advances a state and nothing else. An archive that removes
		// items on a timer is not an archive.
		const d = db([{ original_sha256: 'a'.repeat(64), created_bucket: '2020-01-01', rescan_count: 9 }]);
		await sweepProbation({ DB: d.binding } as never, '2027-01-01');
		expect(d.updates).toHaveLength(1);
		expect(d.updates[0]![0]).toBe('CLEARED');
	});
});
