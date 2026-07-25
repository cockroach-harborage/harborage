/**
 * SpendCap: strong consistency, the reserved priority floor, and the UTC-day
 * epoch. Each is a place where a plausible-looking implementation over-spends
 * or starves the wrong queue.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpendCap } from '../src/do/SpendCap.ts';
import { ReReviewQueue } from '../src/do/ReReviewQueue.ts';

/** In-memory stand-in for the synchronous SQLite storage API. */
function fakeCtx() {
	const rows = new Map<string, { epoch: string; spent: number; priority_spent: number }>();
	let alarm: number | null = null;
	const due = new Map<string, { item_id: string; due_ms: number; priority: number }>();
	return {
		rows,
		due,
		getAlarmValue: () => alarm,
		storage: {
			sql: {
				exec(sql: string, ...binds: unknown[]) {
					const s = sql.replace(/\s+/g, ' ').trim();
					if (/^CREATE/i.test(s)) return { toArray: () => [] };
					if (/SELECT \* FROM counter WHERE epoch/i.test(s)) {
						const r = rows.get(String(binds[0]));
						return { toArray: () => (r ? [r] : []) };
					}
					if (/INSERT INTO counter/i.test(s)) {
						const [epoch, cost, pcost] = binds as [string, number, number];
						const cur = rows.get(epoch) ?? { epoch, spent: 0, priority_spent: 0 };
						cur.spent += cost;
						cur.priority_spent += pcost;
						rows.set(epoch, cur);
						return { toArray: () => [] };
					}
					if (/INSERT INTO due/i.test(s)) {
						const [id, dueMs, priority] = binds as [string, number, number];
						const prev = due.get(id);
						due.set(id, {
							item_id: id,
							due_ms: prev ? Math.min(prev.due_ms, dueMs) : dueMs,
							priority: prev ? Math.max(prev.priority, priority) : priority
						});
						return { toArray: () => [] };
					}
					if (/SELECT \* FROM due WHERE due_ms/i.test(s)) {
						const [now, limit] = binds as [number, number];
						const list = [...due.values()]
							.filter((d) => d.due_ms <= now)
							.sort((a, b) => b.priority - a.priority || a.due_ms - b.due_ms)
							.slice(0, limit);
						return { toArray: () => list };
					}
					if (/DELETE FROM due/i.test(s)) {
						due.delete(String(binds[0]));
						return { toArray: () => [] };
					}
					if (/SELECT MIN\(due_ms\)/i.test(s)) {
						const vals = [...due.values()].map((d) => d.due_ms);
						return { toArray: () => [{ next_due: vals.length ? Math.min(...vals) : null }] };
					}
					if (/SELECT COUNT/i.test(s)) return { toArray: () => [{ n: due.size }] };
					return { toArray: () => [] };
				}
			},
			async getAlarm() {
				return alarm;
			},
			async setAlarm(t: number) {
				alarm = t;
			}
		}
	};
}

function newCap() {
	const ctx = fakeCtx();
	return {
		ctx,
		cap: new (SpendCap as unknown as new (c: unknown, e: unknown) => SpendCap)(ctx, {})
	};
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-07-25T10:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('spend cap', () => {
	it('grants until the bulk ceiling then degrades, never throwing', async () => {
		const { cap } = newCap();
		let granted = 0;
		for (let i = 0; i < 100; i++) {
			const r = await cap.reserve(100, 'bulk');
			if (r.granted) granted++;
		}
		// Bulk may only use budget above the reserved priority floor.
		expect(granted).toBe(60);
		const last = await cap.reserve(100, 'bulk');
		expect(last.granted).toBe(false);
		expect(last.mode).toBe('community-only');
	});

	// The DoS-to-degrade attack: a submission flood must not starve real
	// incidents of scoring simply by arriving first.
	it('keeps a floor that bulk load cannot consume', async () => {
		const { cap } = newCap();
		for (let i = 0; i < 100; i++) await cap.reserve(100, 'bulk');
		expect((await cap.reserve(100, 'bulk')).granted).toBe(false);
		// Priority work still gets through.
		expect((await cap.reserve(100, 'priority')).granted).toBe(true);
	});

	it('steps down through the ladder rather than falling off a cliff', async () => {
		const { cap } = newCap();
		expect((await cap.reserve(10)).mode).toBe('full');
		for (let i = 0; i < 50; i++) await cap.reserve(100, 'bulk');
		expect((await cap.reserve(10)).mode).toBe('prefiltered');
	});

	// Verified against the live Workers AI pricing page: limits reset at 00:00
	// UTC. A rolling 24h window would drift out of step with the real reset.
	it('resets on the UTC day boundary, not on a rolling window', async () => {
		const { cap } = newCap();
		for (let i = 0; i < 100; i++) await cap.reserve(100, 'bulk');
		expect((await cap.reserve(100, 'bulk')).granted).toBe(false);

		vi.setSystemTime(new Date('2026-07-26T00:00:01Z'));
		expect((await cap.reserve(100, 'bulk')).granted).toBe(true);
	});

	it('treats a negative or fractional estimate as a whole non-negative cost', async () => {
		const { cap } = newCap();
		expect((await cap.reserve(-500)).granted).toBe(true);
		expect((await cap.reserve(1.9)).granted).toBe(true);
	});

	it('reports status without spending anything', async () => {
		const { cap } = newCap();
		await cap.reserve(1000, 'bulk');
		const before = cap.status();
		cap.status();
		expect(cap.status().spent).toBe(before.spent);
	});
});

function newQueue() {
	const ctx = fakeCtx();
	return {
		ctx,
		q: new (ReReviewQueue as unknown as new (c: unknown, e: unknown) => ReReviewQueue)(ctx, {})
	};
}

describe('re-review queue', () => {
	it('drains only what is due, highest priority first', async () => {
		const { q } = newQueue();
		await q.schedule('low', 0, 0);
		await q.schedule('high', 0, 5);
		await q.schedule('later', 60 * 60_000, 9);
		expect(await q.drain()).toEqual(['high', 'low']);
		expect(await q.pending()).toBe(1);
	});

	// A DO has ONE alarm and setAlarm REPLACES it, so a naive per-item design
	// silently loses every earlier wake-up. This asserts the alarm only ever
	// moves earlier.
	it('never lets a far-future item push the wake-up back', async () => {
		const { ctx, q } = newQueue();
		await q.schedule('soon', 1000);
		const first = ctx.getAlarmValue();
		await q.schedule('much-later', 24 * 60 * 60_000);
		expect(ctx.getAlarmValue()).toBe(first);
	});

	it('keeps the earliest due time when an item is rescheduled', async () => {
		const { q } = newQueue();
		await q.schedule('x', 60 * 60_000);
		await q.schedule('x', 0);
		expect(await q.drain()).toEqual(['x']);
	});

	it('re-arms itself while work remains', async () => {
		const { ctx, q } = newQueue();
		await q.schedule('a', 0);
		await q.schedule('b', 60 * 60_000);
		await q.alarm();
		expect(await q.pending()).toBe(1);
		expect(ctx.getAlarmValue()).not.toBeNull();
	});
});
