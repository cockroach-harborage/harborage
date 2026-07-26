/**
 * DeadlineTimer DO (ARCHITECTURE §8.3; PRD §4.11). Sixteen fixed shards, each
 * holding one alarm that marks due legal deadlines.
 *
 * WHAT THIS BUYS, STATED HONESTLY AND NARROWLY. The lawyer's on-device calendar is
 * PRIMARY. This object buys exactly one thing over it: a deadline that survives
 * that phone being seized, lost, or dead. It is a backup reminder, not a system of
 * record, and no copy anywhere may imply otherwise.
 *
 * WHAT IT HOLDS: an opaque ref hash, an HOUR, and a closed kind. Never a
 * timestamp — an Article 22 production deadline stored to the second IS an arrest
 * timestamp, because subtracting twenty-four hours gives the minute a named person
 * was taken. D1 Time Travel is ~30 days and cannot be disabled, so a compelled
 * restore would hand that over for every row. Hour granularity costs nothing (the
 * lead time is hours) and removes the arrest minute. The honest floor for a
 * compelled restore is therefore {opaque hash, hour, kind}.
 *
 * THE ALARM FIRES NOTHING OUTBOUND. It flips `fired` and re-arms. There is no
 * notification path, no queue enqueue, no email, no push — a server that could
 * reach the lawyer is a server that holds a way to reach the lawyer, which is the
 * compellable roster this platform refuses to build. The lawyer POLLS.
 *
 * ONE ALARM PER SHARD, NOT ONE PER ROW. A Durable Object has ONE alarm and each
 * setAlarm() REPLACES the previous, so per-row scheduling silently keeps only the
 * last. The ReReviewQueue pattern: point the single alarm at the earliest due row
 * and re-arm while work remains. Each setAlarm() also bills as a row written.
 *
 * SIXTEEN SHARDS, keyed on the first byte of the ref hash, mirroring RateLimit's
 * GLOBAL_SHARDS. Sharding here is about alarm contention rather than volume: one
 * DO draining every deadline in the country is one alarm and one single-threaded
 * loop.
 *
 * SQLITE_OK in gate-memory-only: durable is the whole point, since the object
 * exists to outlive a device.
 */
import { DurableObject } from 'cloudflare:workers';

/** Mirrors RateLimit's GLOBAL_SHARDS. A power of two so the first byte maps evenly. */
export const DEADLINE_SHARDS = 16;

/** Closed kinds. A free-text kind would carry the charge. */
export const DEADLINE_KINDS = ['production', 'bail_hearing', 'remand_review', 'filing'] as const;
export type DeadlineKind = (typeof DEADLINE_KINDS)[number];

/** Rows drained per alarm tick, so one shard cannot monopolise the thread. */
const DRAIN_BATCH = 64;

/**
 * How long a fired row is kept before it is swept.
 *
 * Bounded, because a fired row is still {hash, hour, kind} and there is no reason
 * to hold it once the lawyer has polled. Seven days is the outer edge of "the
 * hearing was last week and I am checking what I missed".
 */
export const FIRED_RETENTION_HOURS = 24 * 7;

export function shardFor(refHash: string): number {
	const first = Number.parseInt(refHash.slice(0, 2) || '0', 16);
	return (Number.isNaN(first) ? 0 : first) % DEADLINE_SHARDS;
}

export function hourOf(nowMs: number): number {
	return Math.floor(nowMs / 3_600_000);
}

/**
 * What a poll returns.
 *
 * FIXED SHAPE, AND `known` IS ALWAYS PRESENT. An unknown ref returns
 * `{known: false, kind: null, hour: null, fired: false}` rather than null or a
 * 404, because a poll that answered differently for an unknown ref would be an
 * EXISTENCE ORACLE over guessed hashes: an adversary holding a candidate ref could
 * test whether this platform is tracking that matter.
 */
export interface DeadlineView {
	known: boolean;
	kind: DeadlineKind | null;
	hour: number | null;
	fired: boolean;
}

type Row = {
	[column: string]: SqlStorageValue;
	ref_hash: string;
	kind: string;
	deadline_hour: number;
	fired: number;
	created_hour: number;
};

interface Env {
	FLAGS: KVNamespace;
}

export class DeadlineTimer extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS deadline (
				ref_hash TEXT PRIMARY KEY,
				kind TEXT NOT NULL,
				deadline_hour INTEGER NOT NULL,
				fired INTEGER NOT NULL DEFAULT 0,
				created_hour INTEGER NOT NULL
			);
		`);
	}

	/**
	 * Record or move a deadline.
	 *
	 * Idempotent on ref_hash: re-arming a matter replaces its hour rather than
	 * adding a row, so a lawyer who re-syncs does not accumulate duplicates. Moving
	 * a deadline clears `fired`, because a rescheduled hearing has not passed.
	 */
	async arm(input: {
		refHash: string;
		kind: DeadlineKind;
		deadlineHour: number;
		nowMs?: number;
	}): Promise<boolean> {
		if (!(DEADLINE_KINDS as readonly string[]).includes(input.kind)) return false;
		if (!Number.isInteger(input.deadlineHour)) return false;
		this.ctx.storage.sql.exec(
			`INSERT INTO deadline (ref_hash, kind, deadline_hour, fired, created_hour)
			 VALUES (?, ?, ?, 0, ?)
			 ON CONFLICT (ref_hash) DO UPDATE SET
			   kind = excluded.kind, deadline_hour = excluded.deadline_hour, fired = 0`,
			input.refHash,
			input.kind,
			input.deadlineHour,
			hourOf(input.nowMs ?? Date.now())
		);
		await this.rearm(input.nowMs ?? Date.now());
		return true;
	}

	/** Forget a matter. No checks: a lawyer withdrawing a reminder must always work. */
	async disarm(refHash: string, nowMs = Date.now()): Promise<void> {
		this.ctx.storage.sql.exec('DELETE FROM deadline WHERE ref_hash = ?', refHash);
		await this.rearm(nowMs);
	}

	/**
	 * The lawyer's poll. Same work whether the ref exists or not.
	 *
	 * The sweep runs first on EVERY poll, known ref or not, so the two paths do the
	 * same amount of work. A poll that was measurably faster for an unknown ref
	 * would be the existence oracle the fixed shape is there to prevent.
	 */
	async poll(refHash: string, nowMs = Date.now()): Promise<DeadlineView> {
		this.sweep(nowMs);
		const row = this.ctx.storage.sql
			.exec<Row>('SELECT * FROM deadline WHERE ref_hash = ?', refHash)
			.toArray()[0];
		if (!row) return { known: false, kind: null, hour: null, fired: false };
		return {
			known: true,
			kind: row.kind as DeadlineKind,
			hour: row.deadline_hour,
			fired: row.fired === 1
		};
	}

	/**
	 * Mark everything due, then re-arm.
	 *
	 * FIRES NOTHING OUTBOUND. The only effect is `fired = 1`. A server that could
	 * reach the lawyer is a server holding a way to reach the lawyer.
	 */
	override async alarm(): Promise<void> {
		const now = Date.now();
		const hour = hourOf(now);
		this.ctx.storage.sql.exec(
			`UPDATE deadline SET fired = 1
			 WHERE ref_hash IN (
			   SELECT ref_hash FROM deadline WHERE fired = 0 AND deadline_hour <= ?
			   ORDER BY deadline_hour LIMIT ?
			 )`,
			hour,
			DRAIN_BATCH
		);
		this.sweep(now);
		await this.rearm(now);
	}

	/** Drop long-fired rows. A fired row is still {hash, hour, kind}. */
	private sweep(nowMs: number): void {
		this.ctx.storage.sql.exec(
			'DELETE FROM deadline WHERE fired = 1 AND deadline_hour < ?',
			hourOf(nowMs) - FIRED_RETENTION_HOURS
		);
	}

	/**
	 * Point the single alarm at the earliest unfired deadline.
	 *
	 * Cleared when nothing is pending, so an empty shard costs no ticks. Rows
	 * already past due schedule for `now`, not for their own hour, or a deadline
	 * missed during an outage would never be marked.
	 */
	private async rearm(nowMs: number): Promise<void> {
		const next = this.ctx.storage.sql
			.exec<{ h: number | null }>('SELECT MIN(deadline_hour) AS h FROM deadline WHERE fired = 0')
			.toArray()[0]?.h;
		if (next === null || next === undefined) {
			await this.ctx.storage.deleteAlarm();
			return;
		}
		await this.ctx.storage.setAlarm(Math.max(next * 3_600_000, nowMs));
	}

	/** Unfired count for this shard, for the operator surface. Never a ref. */
	async pending(): Promise<number> {
		return (
			this.ctx.storage.sql
				.exec<{ n: number }>('SELECT COUNT(*) AS n FROM deadline WHERE fired = 0')
				.toArray()[0]?.n ?? 0
		);
	}
}
