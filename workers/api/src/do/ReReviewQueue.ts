/**
 * ReReviewQueue DO (ARCHITECTURE §15 "Appeals & error-recovery without humans").
 *
 * Nothing good is permanently lost while humans are absent. Every autonomously
 * actioned item is retained-pending and comes back for a fresh look, so the
 * empty-queue failure mode is "held safely, auto-re-checked" and never "lost".
 *
 * ONE alarm for the whole queue, deliberately, not one per item. Two reasons,
 * both learned from the platform rather than from taste:
 *
 *   1. A Durable Object has ONE alarm. Setting it per item does not schedule
 *      many alarms — each `setAlarm()` REPLACES the previous one, so a naive
 *      per-item design silently loses every earlier wake-up.
 *   2. Each `setAlarm()` bills as a row written. One tick that drains a due
 *      batch costs a fraction of one write per item.
 *
 * The alarm re-arms itself while work remains, so the queue keeps draining
 * without anything external poking it.
 */
import { DurableObject } from 'cloudflare:workers';

/** §15: a fresh pass roughly every six hours. */
export const DEFAULT_INTERVAL_MS = 6 * 60 * 60_000;

/** How many items one tick drains, so a backlog cannot blow the CPU budget. */
const BATCH = 100;

interface DueRow {
	[column: string]: SqlStorageValue;
	item_id: string;
	due_ms: number;
	priority: number;
}

export class ReReviewQueue extends DurableObject {
	constructor(ctx: DurableObjectState, env: unknown) {
		super(ctx, env as never);
		this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS due (
				item_id TEXT PRIMARY KEY,
				due_ms INTEGER NOT NULL,
				priority INTEGER NOT NULL DEFAULT 0
			);
			CREATE INDEX IF NOT EXISTS idx_due_when ON due (due_ms);
			CREATE INDEX IF NOT EXISTS idx_due_priority ON due (priority);
		`);
	}

	/**
	 * Schedule an item for another look.
	 *
	 * §15 prioritises Disputed items with high independent corroboration to the
	 * top of the human queue: the muddy-the-waters steady state is expected, so
	 * the contested-but-well-corroborated case is the one a reviewer should meet
	 * first rather than the one buried under a flood.
	 */
	async schedule(itemId: string, delayMs = DEFAULT_INTERVAL_MS, priority = 0): Promise<void> {
		const dueMs = Date.now() + Math.max(0, delayMs);
		this.ctx.storage.sql.exec(
			`INSERT INTO due (item_id, due_ms, priority) VALUES (?1, ?2, ?3)
			 ON CONFLICT(item_id) DO UPDATE SET
				due_ms = MIN(due.due_ms, excluded.due_ms),
				priority = MAX(due.priority, excluded.priority)`,
			itemId,
			dueMs,
			priority
		);
		await this.arm();
	}

	/** Items due now, highest priority first. Removed as they are handed out. */
	async drain(nowMs = Date.now()): Promise<string[]> {
		const rows = this.ctx.storage.sql
			.exec<DueRow>(
				'SELECT * FROM due WHERE due_ms <= ? ORDER BY priority DESC, due_ms ASC LIMIT ?',
				nowMs,
				BATCH
			)
			.toArray();
		for (const row of rows) {
			this.ctx.storage.sql.exec('DELETE FROM due WHERE item_id = ?', row.item_id);
		}
		return rows.map((r) => r.item_id);
	}

	async pending(): Promise<number> {
		const rows = this.ctx.storage.sql
			.exec<{ n: number }>('SELECT COUNT(*) AS n FROM due')
			.toArray();
		return rows[0]?.n ?? 0;
	}

	/**
	 * The single tick. Re-arms while anything remains, so the queue drains
	 * without an external poke.
	 */
	override async alarm(): Promise<void> {
		await this.drain();
		await this.arm();
	}

	/** Point the one alarm at the earliest due item. */
	private async arm(): Promise<void> {
		const next = this.ctx.storage.sql
			.exec<{ next_due: number | null }>('SELECT MIN(due_ms) AS next_due FROM due')
			.toArray()[0]?.next_due;
		if (next === null || next === undefined) return;
		const existing = await this.ctx.storage.getAlarm();
		// Only move the alarm earlier. Re-arming to a later time on every
		// schedule() would let a steady trickle of far-future items keep pushing
		// the wake-up back and starve the ones already due.
		if (existing === null || next < existing) {
			await this.ctx.storage.setAlarm(Math.max(next, Date.now() + 1000));
		}
	}
}
