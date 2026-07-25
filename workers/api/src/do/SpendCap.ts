/**
 * SpendCap DO (ARCHITECTURE §15 "Spend caps & degrade"). A single instance
 * holding the daily Neuron counter, so `reserve()` is strongly consistent.
 *
 * WHY reserve() HAS NO `await` IN IT. Durable Objects are single-threaded, but
 * `await` on non-storage I/O opens the input gate and lets another request
 * interleave. A reserve that read the counter, awaited anything, then wrote it
 * back would let two concurrent reservations both see the same remaining budget
 * and both succeed — which is precisely the over-spend the cap exists to stop.
 * The SQLite storage API is synchronous, so the read-modify-write below runs in
 * one uninterrupted turn.
 *
 * EPOCH IS THE UTC DAY, not a rolling 24h window and not local midnight.
 * Verified against the live Workers AI pricing page: "All limits reset daily at
 * 00:00 UTC." A rolling window would drift out of step with the thing it is
 * modelling and either over- or under-spend every day.
 *
 * The ladder this feeds (§15) is fail-toward-not-suppressing-truth: at cap,
 * community-only items may still reach Corroborating, but Community-Corroborated
 * is HELD because its AI-concurrence precondition is unmet. AI concurrence is
 * never silently waived to unblock a promotion.
 */
import { DurableObject } from 'cloudflare:workers';

/** Free allocation is 10,000 Neurons/day; stay well inside it. */
const DAILY_BUDGET = 8000;

/**
 * A floor reserved for life-safety, detention and high-reach items that bulk
 * load CANNOT consume. Without it, an attacker's submission flood starves real
 * incidents of scoring simply by arriving first — the DoS-to-degrade attack.
 */
const PRIORITY_FLOOR = 2000;

export type Priority = 'bulk' | 'priority';

/** §15 degrade ladder: full AI -> cheaper/prefiltered -> Tier-0 + community. */
export type DegradeMode = 'full' | 'prefiltered' | 'community-only';

export interface Reservation {
	granted: boolean;
	mode: DegradeMode;
	remaining: number;
}

interface CounterRow {
	[column: string]: SqlStorageValue;
	epoch: string;
	spent: number;
	priority_spent: number;
}

/** UTC day. See the header for why this is not a rolling window. */
function utcDay(nowMs: number): string {
	return new Date(nowMs).toISOString().slice(0, 10);
}

export class SpendCap extends DurableObject {
	constructor(ctx: DurableObjectState, env: unknown) {
		super(ctx, env as never);
		this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS counter (
				epoch TEXT PRIMARY KEY,
				spent INTEGER NOT NULL DEFAULT 0,
				priority_spent INTEGER NOT NULL DEFAULT 0
			);
		`);
	}

	/**
	 * Reserve budget before a paid call. Synchronous read-modify-write, no
	 * `await` between the read and the write.
	 */
	async reserve(estimate: number, priority: Priority = 'bulk'): Promise<Reservation> {
		const epoch = utcDay(Date.now());
		const row =
			this.ctx.storage.sql
				.exec<CounterRow>('SELECT * FROM counter WHERE epoch = ?', epoch)
				.toArray()[0] ?? null;
		const spent = row?.spent ?? 0;

		// Bulk work may only touch the budget above the reserved floor.
		const ceiling = priority === 'priority' ? DAILY_BUDGET : DAILY_BUDGET - PRIORITY_FLOOR;
		const remaining = Math.max(0, ceiling - spent);
		const cost = Math.max(0, Math.trunc(estimate));

		if (cost > remaining) {
			// Capped is a first-class SUSTAINED mode, not an emergency: a national
			// protest day will sit here. Degrade, never stall.
			return { granted: false, mode: 'community-only', remaining };
		}

		this.ctx.storage.sql.exec(
			`INSERT INTO counter (epoch, spent, priority_spent) VALUES (?1, ?2, ?3)
			 ON CONFLICT(epoch) DO UPDATE SET
				spent = counter.spent + ?2,
				priority_spent = counter.priority_spent + ?3`,
			epoch,
			cost,
			priority === 'priority' ? cost : 0
		);

		const after = remaining - cost;
		return { granted: true, mode: modeFor(after, ceiling), remaining: after };
	}

	/** Read-only view for the console, so a look does not spend anything. */
	status(): { epoch: string; spent: number; remaining: number; mode: DegradeMode } {
		const epoch = utcDay(Date.now());
		const row =
			this.ctx.storage.sql
				.exec<CounterRow>('SELECT * FROM counter WHERE epoch = ?', epoch)
				.toArray()[0] ?? null;
		const spent = row?.spent ?? 0;
		const ceiling = DAILY_BUDGET - PRIORITY_FLOOR;
		const remaining = Math.max(0, ceiling - spent);
		return { epoch, spent, remaining, mode: modeFor(remaining, ceiling) };
	}
}

/** Step down before the wall, so the drop is gradual rather than a cliff. */
function modeFor(remaining: number, ceiling: number): DegradeMode {
	if (remaining <= 0) return 'community-only';
	if (remaining < ceiling * 0.25) return 'prefiltered';
	return 'full';
}
