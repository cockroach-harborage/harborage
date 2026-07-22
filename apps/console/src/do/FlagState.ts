/**
 * FlagState DO (ARCHITECTURE §10.3, §17.4): the strongly consistent source of
 * truth for kill switches and heightened-threat mode, with an append-only
 * who/when/why audit. Writes through to the FLAGS KV namespace; readers use the
 * short-TTL KV cache and fail closed. Propagation bound is the cache TTL, per
 * colo — never claim "instant".
 *
 * SQLite here holds NON-PERSONAL config + staff-pseudonym audit rows only.
 * No user data, no location, no timing signals (§18.3: not an invariant class,
 * but keep it boring).
 */
import { DurableObject } from 'cloudflare:workers';
import type { FlagRecord } from '@harborage/worker-lib/flags';
import { isFlippable, isLocked } from '../flag-policy.ts';

export type FlagRow = {
	[column: string]: SqlStorageValue;
	name: string;
	enabled: number;
	epoch: number;
	updated_at: string;
};

export type AuditRow = {
	[column: string]: SqlStorageValue;
	at: string;
	name: string;
	action: string;
	actor: string;
	reason: string;
};

interface Env {
	FLAGS: KVNamespace;
	DB: D1Database;
}

export class FlagState extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS flags (
				name TEXT PRIMARY KEY,
				enabled INTEGER NOT NULL DEFAULT 0,
				epoch INTEGER NOT NULL DEFAULT 0,
				updated_at TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS audit (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				at TEXT NOT NULL,
				name TEXT NOT NULL,
				action TEXT NOT NULL,
				actor TEXT NOT NULL,
				reason TEXT NOT NULL
			);
		`);
	}

	list(): FlagRow[] {
		return this.ctx.storage.sql
			.exec<FlagRow>('SELECT name, enabled, epoch, updated_at FROM flags ORDER BY name')
			.toArray();
	}

	auditTail(limit = 50): AuditRow[] {
		return this.ctx.storage.sql
			.exec<AuditRow>(
				'SELECT at, name, action, actor, reason FROM audit ORDER BY id DESC LIMIT ?',
				limit
			)
			.toArray();
	}

	/**
	 * Flip a reversible flag. Locked flags are refused unconditionally and the
	 * attempt itself is audited. Returns the new record, or null if refused.
	 */
	async flip(
		name: string,
		enabled: boolean,
		actor: string,
		reason: string
	): Promise<FlagRecord | null> {
		const now = new Date().toISOString();
		if (isLocked(name) || !isFlippable(name)) {
			this.audit(now, name, 'refused', actor, reason);
			return null;
		}
		const prior = this.ctx.storage.sql
			.exec<FlagRow>('SELECT name, enabled, epoch, updated_at FROM flags WHERE name = ?', name)
			.toArray()[0];
		const epoch = (prior?.epoch ?? 0) + 1;
		this.ctx.storage.sql.exec(
			`INSERT INTO flags (name, enabled, epoch, updated_at) VALUES (?, ?, ?, ?)
			 ON CONFLICT(name) DO UPDATE SET enabled = excluded.enabled, epoch = excluded.epoch, updated_at = excluded.updated_at`,
			name,
			enabled ? 1 : 0,
			epoch,
			now
		);
		this.audit(now, name, enabled ? 'enable' : 'disable', actor, reason);

		const record: FlagRecord = { enabled, epoch, updatedAt: now };
		// Write-through: KV is the read path for every other worker.
		await this.env.FLAGS.put(`flag:${name}`, JSON.stringify(record));
		// Mirror the audit row to D1 for operator reporting. Best-effort: the DO
		// audit table is the source of truth and already committed.
		try {
			await this.env.DB.prepare(
				'INSERT INTO feature_flag_audit (at, name, action, actor, reason) VALUES (?1, ?2, ?3, ?4, ?5)'
			)
				.bind(now, name, enabled ? 'enable' : 'disable', actor, reason)
				.run();
		} catch {
			// D1 mirror can lag; reconciled from the DO audit table.
		}
		return record;
	}

	private audit(at: string, name: string, action: string, actor: string, reason: string): void {
		this.ctx.storage.sql.exec(
			'INSERT INTO audit (at, name, action, actor, reason) VALUES (?, ?, ?, ?, ?)',
			at,
			name,
			action,
			actor,
			reason
		);
	}
}
