/**
 * DeadlineTimer (ARCHITECTURE §8.3). Mostly a suite about what this object
 * REFUSES to know and REFUSES to do.
 *
 * The two claims that carry weight: nothing stored is finer than an hour, because
 * an Article 22 deadline stored to the second is an arrest timestamp; and the
 * alarm fires nothing outbound, because a server that can reach the lawyer is a
 * server holding a way to reach the lawyer.
 *
 * Real SQLite, for the same reason ReviewGate uses it: the ON CONFLICT that makes
 * arm() idempotent, and the MIN() that picks the next alarm, are the behaviour
 * under test.
 */
import { describe, expect, it } from 'vitest';
import { sqliteCtx } from './stubs/sqlite-ctx.mjs';
import {
	DEADLINE_KINDS,
	DEADLINE_SHARDS,
	DeadlineTimer,
	FIRED_RETENTION_HOURS,
	hourOf,
	shardFor
} from '../src/do/DeadlineTimer.ts';

const REF = 'a1b2c3'.padEnd(64, '0');
const OTHER = 'ff9911'.padEnd(64, '0');
/** Hour-aligned, so an expectation about hours is not an expectation about rounding. */
const BASE = Math.floor(1_785_000_000_000 / 3_600_000) * 3_600_000;
const HOUR = BASE / 3_600_000;

function newTimer(): DeadlineTimer {
	return new DeadlineTimer(sqliteCtx(), { FLAGS: {} as KVNamespace });
}

describe('nothing here is finer than an hour', () => {
	/**
	 * THE FINDING THIS OBJECT EXISTS AROUND. A production deadline is arrest time
	 * plus twenty-four hours, so stored to the second it IS an arrest timestamp:
	 * subtract 24h and you have the minute a named person was taken, for every row.
	 * D1 Time Travel and DO PITR are ~30 days and cannot be disabled.
	 */
	it('discards minute precision on the deadline it reports', async () => {
		const t = newTimer();
		await t.arm({ refHash: REF, kind: 'production', deadlineHour: HOUR + 24, nowMs: BASE });
		const v = await t.poll(REF, BASE);
		expect(v.hour).toBe(HOUR + 24);
		// An hour, not a millisecond: the value is ~5e5, not ~1.7e12.
		expect(v.hour!).toBeLessThan(1e7);
	});

	it('buckets the current time to the hour', () => {
		expect(hourOf(BASE)).toBe(HOUR);
		expect(hourOf(BASE + 59 * 60_000)).toBe(HOUR);
		expect(hourOf(BASE + 60 * 60_000)).toBe(HOUR + 1);
	});

	/** No field anywhere in a poll response carries a finer unit. */
	it('returns no millisecond, date string, or extra field', async () => {
		const t = newTimer();
		await t.arm({ refHash: REF, kind: 'bail_hearing', deadlineHour: HOUR + 6, nowMs: BASE });
		const v = await t.poll(REF, BASE);
		expect(Object.keys(v).sort()).toEqual(['fired', 'hour', 'kind', 'known']);
		expect(JSON.stringify(v)).not.toMatch(/\d{13}/);
		expect(JSON.stringify(v)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
	});
});

describe('a poll is not an existence oracle', () => {
	/**
	 * An adversary holding a candidate ref must not learn whether this platform is
	 * tracking that matter. So an unknown ref gets the SAME SHAPE, not a null and
	 * not a 404 — every key present, every value empty.
	 */
	it('answers an unknown ref with the same shape as a known one', async () => {
		const t = newTimer();
		await t.arm({ refHash: REF, kind: 'filing', deadlineHour: HOUR + 2, nowMs: BASE });
		const known = await t.poll(REF, BASE);
		const unknown = await t.poll(OTHER, BASE);
		expect(Object.keys(unknown).sort()).toEqual(Object.keys(known).sort());
		expect(unknown).toEqual({ known: false, kind: null, hour: null, fired: false });
	});

	/** It does not throw and does not create a row on the way past. */
	it('leaves no trace of a poll for an unknown ref', async () => {
		const t = newTimer();
		await t.poll(OTHER, BASE);
		expect((await t.poll(OTHER, BASE)).known).toBe(false);
		expect(await t.pending()).toBe(0);
	});
});

describe('the alarm marks and nothing else', () => {
	/**
	 * NO NOTIFICATION PATH. The only effect of a due deadline is `fired = 1`. A
	 * server that could reach the lawyer is a server holding a way to reach the
	 * lawyer, which is exactly the compellable roster this platform refuses to build.
	 * Asserted structurally over the module's exports, not left to review.
	 */
	it('exports nothing that could send anything', async () => {
		const mod = await import('../src/do/DeadlineTimer.ts');
		for (const name of Object.keys(mod))
			expect(name).not.toMatch(/notify|send|email|push|sms|dispatch|enqueue|webhook/i);
		const src = DeadlineTimer.prototype;
		for (const name of Object.getOwnPropertyNames(src))
			expect(name).not.toMatch(/notify|send|email|push|sms|dispatch|enqueue|webhook/i);
	});

	it('flips fired when the hour arrives, and not before', async () => {
		const t = newTimer();
		await t.arm({ refHash: REF, kind: 'production', deadlineHour: HOUR + 2, nowMs: BASE });
		expect((await t.poll(REF, BASE)).fired).toBe(false);
		await t.alarm();
		// alarm() reads the real clock, which is far past this fixture's hour.
		expect((await t.poll(REF, BASE)).fired).toBe(true);
	});

	/** A rescheduled hearing has not passed. */
	it('clears fired when a deadline is moved', async () => {
		const t = newTimer();
		await t.arm({ refHash: REF, kind: 'production', deadlineHour: HOUR - 1, nowMs: BASE });
		await t.alarm();
		expect((await t.poll(REF, BASE)).fired).toBe(true);
		await t.arm({ refHash: REF, kind: 'production', deadlineHour: HOUR + 48, nowMs: BASE });
		expect((await t.poll(REF, BASE)).fired).toBe(false);
	});
});

describe('one alarm per shard, re-armed', () => {
	/**
	 * A Durable Object has ONE alarm and each setAlarm() REPLACES the previous, so
	 * per-row scheduling silently keeps only the last. The single alarm points at
	 * the EARLIEST unfired deadline.
	 */
	it('points the alarm at the earliest unfired deadline', async () => {
		const ctx = sqliteCtx();
		const t = new DeadlineTimer(ctx, { FLAGS: {} as KVNamespace });
		await t.arm({ refHash: REF, kind: 'filing', deadlineHour: HOUR + 10, nowMs: BASE });
		expect(await ctx.storage.getAlarm()).toBe((HOUR + 10) * 3_600_000);
		await t.arm({ refHash: OTHER, kind: 'production', deadlineHour: HOUR + 3, nowMs: BASE });
		expect(await ctx.storage.getAlarm()).toBe((HOUR + 3) * 3_600_000);
	});

	/** An empty shard costs no ticks. */
	it('clears the alarm when nothing is pending', async () => {
		const ctx = sqliteCtx();
		const t = new DeadlineTimer(ctx, { FLAGS: {} as KVNamespace });
		await t.arm({ refHash: REF, kind: 'filing', deadlineHour: HOUR + 10, nowMs: BASE });
		expect(await ctx.storage.getAlarm()).not.toBeNull();
		await t.disarm(REF, BASE);
		expect(await ctx.storage.getAlarm()).toBeNull();
	});

	/**
	 * A deadline missed during an outage must still be marked. An already-due row
	 * schedules for NOW, not for its own hour in the past.
	 */
	it('schedules an overdue deadline for now rather than the past', async () => {
		const ctx = sqliteCtx();
		const t = new DeadlineTimer(ctx, { FLAGS: {} as KVNamespace });
		await t.arm({ refHash: REF, kind: 'production', deadlineHour: HOUR - 50, nowMs: BASE });
		expect(await ctx.storage.getAlarm()).toBe(BASE);
	});
});

describe('arming is idempotent and closed', () => {
	/** A lawyer re-syncing must not accumulate duplicate rows. */
	it('replaces rather than duplicates on the same ref', async () => {
		const t = newTimer();
		await t.arm({ refHash: REF, kind: 'production', deadlineHour: HOUR + 5, nowMs: BASE });
		await t.arm({ refHash: REF, kind: 'bail_hearing', deadlineHour: HOUR + 9, nowMs: BASE });
		expect(await t.pending()).toBe(1);
		expect(await t.poll(REF, BASE)).toMatchObject({ kind: 'bail_hearing', hour: HOUR + 9 });
	});

	/** A free-text kind would carry the charge. */
	it('refuses a kind outside the closed set', async () => {
		const t = newTimer();
		for (const kind of ['custody', 'other', '', 'production ']) {
			expect(
				await t.arm({
					refHash: REF,
					kind: kind as (typeof DEADLINE_KINDS)[number],
					deadlineHour: HOUR,
					nowMs: BASE
				}),
				kind
			).toBe(false);
		}
		expect(await t.pending()).toBe(0);
	});

	it('refuses a non-integer hour, which is how a millisecond gets in', async () => {
		const t = newTimer();
		for (const h of [BASE, HOUR + 0.5, NaN]) {
			expect(
				await t.arm({ refHash: REF, kind: 'filing', deadlineHour: h, nowMs: BASE }),
				String(h)
			).toBe(h === BASE ? true : false);
		}
	});

	/** Withdrawing a reminder always works, like every other fail-toward-less path. */
	it('disarms with no checks, including an unknown ref', async () => {
		const t = newTimer();
		await expect(t.disarm(OTHER, BASE)).resolves.toBeUndefined();
		await t.arm({ refHash: REF, kind: 'filing', deadlineHour: HOUR + 1, nowMs: BASE });
		await t.disarm(REF, BASE);
		expect((await t.poll(REF, BASE)).known).toBe(false);
	});
});

describe('fired rows do not accumulate', () => {
	/** A fired row is still {hash, hour, kind}, and there is no reason to keep it. */
	it('sweeps a long-fired row', async () => {
		const t = newTimer();
		await t.arm({
			refHash: REF,
			kind: 'production',
			deadlineHour: HOUR - FIRED_RETENTION_HOURS - 10,
			nowMs: BASE
		});
		await t.alarm();
		expect((await t.poll(REF, BASE)).known).toBe(false);
	});

	it('keeps a recently-fired row, so a late poll still sees it', async () => {
		const t = newTimer();
		await t.arm({ refHash: REF, kind: 'production', deadlineHour: HOUR - 1, nowMs: BASE });
		await t.alarm();
		expect(await t.poll(REF, BASE)).toMatchObject({ known: true, fired: true });
	});
});

describe('sharding', () => {
	it('maps every ref into the fixed shard range', () => {
		expect(DEADLINE_SHARDS).toBe(16);
		for (const h of [REF, OTHER, '00'.repeat(32), 'ff'.repeat(32), '', 'zz']) {
			const s = shardFor(h);
			expect(Number.isInteger(s), h).toBe(true);
			expect(s >= 0 && s < DEADLINE_SHARDS, h).toBe(true);
		}
	});

	it('is stable, so a ref always reaches the same shard', () => {
		expect(shardFor(REF)).toBe(shardFor(REF));
		expect(shardFor(REF)).not.toBe(shardFor(OTHER));
	});
});
