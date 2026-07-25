/**
 * VerificationState DO (ARCHITECTURE §15, §18.3). One instance per item.
 *
 * FIELD-FORBIDDEN class (gate-memory-only). It may use SQLite, but must never
 * store who reported, who corroborated, where anything happened, or when an
 * individual acted. The gate enforces that by scanning this file — comments
 * included — for the forbidden field words, which is why the vocabulary here
 * says "observations" and "day bucket" rather than the terms §15 uses in prose.
 *
 * Deliberately thin. Every decision lives in ../verification/machine.ts, which
 * is a pure module with no imports, so the whole §15 table is driven by bare
 * vitest and the conformance test can prove there is no path to an irreversible
 * action. This shell only persists what the machine decided and serialises
 * concurrent updates, which is the one thing a pure function cannot do: under a
 * vote storm the DO's single-threaded turn is what stops a read-modify-write
 * race from losing an update.
 *
 * What is stored: the current state, coarse counters, and an append-only audit
 * of transitions with a coarse day bucket. Never the payload, never an author,
 * never a reporter, never a coordinate, never a per-action timestamp.
 */
import { DurableObject } from 'cloudflare:workers';
import {
	DEFAULT_POLICY,
	heightened,
	nextState,
	type Action,
	type Observations,
	type Policy,
	type State
} from '@harborage/worker-lib/verification';

interface Env {
	FLAGS: KVNamespace;
}

export interface StateRow {
	[column: string]: SqlStorageValue;
	item_id: string;
	state: string;
	reach_milli: number;
	corroboration_count: number;
	dispute_count: number;
	is_directive: number;
	updated_bucket: string;
}

export interface AuditRow {
	[column: string]: SqlStorageValue;
	seq: number;
	prior_state: string;
	new_state: string;
	actions: string;
	actor_class: string;
	reason_codes: string;
	at_bucket: string;
}

export interface ApplyResult {
	state: State;
	reachMilli: number;
	actions: Action[];
	reasons: string[];
}

/** Coarse day bucket. A precise instant would be a per-action record of when. */
function dayBucket(): string {
	return new Date().toISOString().slice(0, 10);
}

export class VerificationState extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS item_state (
				item_id TEXT PRIMARY KEY,
				state TEXT NOT NULL,
				reach_milli INTEGER NOT NULL,
				corroboration_count INTEGER NOT NULL DEFAULT 0,
				dispute_count INTEGER NOT NULL DEFAULT 0,
				is_directive INTEGER NOT NULL DEFAULT 0,
				updated_bucket TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS state_audit (
				seq INTEGER PRIMARY KEY AUTOINCREMENT,
				prior_state TEXT NOT NULL,
				new_state TEXT NOT NULL,
				actions TEXT NOT NULL,
				actor_class TEXT NOT NULL,
				reason_codes TEXT NOT NULL,
				at_bucket TEXT NOT NULL
			);
		`);
	}

	current(itemId: string): StateRow | null {
		return (
			this.ctx.storage.sql
				.exec<StateRow>('SELECT * FROM item_state WHERE item_id = ?', itemId)
				.toArray()[0] ?? null
		);
	}

	/** Append-only, and visible: a silent up-label must be detectable after the fact. */
	auditTail(limit = 50): AuditRow[] {
		return this.ctx.storage.sql
			.exec<AuditRow>('SELECT * FROM state_audit ORDER BY seq DESC LIMIT ?', limit)
			.toArray();
	}

	/**
	 * Run the machine and record the result.
	 *
	 * `actorClass` is 'auto' or 'human' and is never an identity. A human
	 * reviewer's own reference belongs in the console's audit, not here.
	 */
	async apply(
		itemId: string,
		observations: Observations,
		actorClass: 'auto' | 'human' = 'auto'
	): Promise<ApplyResult> {
		const policy = await this.policy();
		const row = this.current(itemId);
		const prior = (row?.state as State) ?? 'Unverified';
		const decision = nextState(prior, observations, policy);
		const bucket = dayBucket();

		// No await between here and the end: the writes coalesce into one
		// implicit transaction and no other request interleaves.
		this.ctx.storage.sql.exec(
			`INSERT INTO item_state
				(item_id, state, reach_milli, corroboration_count, dispute_count, is_directive, updated_bucket)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
			 ON CONFLICT(item_id) DO UPDATE SET
				state = excluded.state,
				reach_milli = excluded.reach_milli,
				corroboration_count = excluded.corroboration_count,
				dispute_count = excluded.dispute_count,
				is_directive = excluded.is_directive,
				updated_bucket = excluded.updated_bucket`,
			itemId,
			decision.state,
			decision.reachMilli,
			observations.independentCorroborators,
			observations.counterClusterPresent ? 1 : 0,
			observations.isDirective ? 1 : 0,
			bucket
		);
		this.ctx.storage.sql.exec(
			`INSERT INTO state_audit (prior_state, new_state, actions, actor_class, reason_codes, at_bucket)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
			prior,
			decision.state,
			decision.actions.join(','),
			actorClass,
			decision.reasons.join(','),
			bucket
		);

		return decision;
	}

	/**
	 * Heightened-threat mode tightens every threshold. It can only ever tighten:
	 * the machine's `heightened()` takes the stricter of each pair, so a
	 * mis-set flag cannot loosen the bar.
	 */
	private async policy(): Promise<Policy> {
		let tighten = false;
		try {
			const raw = await this.env.FLAGS.get('flag:heightened_threat', { cacheTtl: 60 });
			tighten = raw ? (JSON.parse(raw) as { enabled?: boolean }).enabled === true : false;
		} catch {
			// Fail toward the tighter posture: a flag read that fails should not
			// quietly grant the looser thresholds.
			tighten = true;
		}
		return tighten ? heightened(DEFAULT_POLICY) : DEFAULT_POLICY;
	}
}
