/**
 * ReviewGate DO (ARCHITECTURE §8.2). The Naming Review gate's state machine.
 *
 * WHAT THIS OBJECT IS: a collector. Reviewers sign on their own APK-gated devices;
 * this DO records WHICH KEYS signed WHICH canonical hash, tracks which of the
 * seven §8.2 conditions somebody has asserted, and emits a bundle when all of them
 * hold. It is SQLITE_OK in gate-memory-only because everything here is either
 * public (signatures, hashes) or non-personal (a condition bitmask).
 *
 * WHAT IT IS NOT, AND THE DISTINCTION IS LOAD-BEARING: this DO cannot publish. Its
 * terminal positive state is READY, not PUBLISHED, and there is no PUBLISHED value
 * anywhere in this file. Publication is a separate act by the api Worker, which
 * re-verifies the bundle from scratch against the pinned key directory. A console
 * compromise therefore yields a bundle that still has to survive verification
 * twice more — once in the api, once on every reader's device.
 *
 * THE CONSOLE HOLDS NO REVIEWER PRIVATE KEY AND PERFORMS NO SIGNING. Reviewer keys
 * are generated in an offline m-of-n ceremony and live on APK-gated reviewer
 * devices; they never enter the repo, CI, or Cloudflare. So a compelled console
 * cannot manufacture a reviewer signature — it can only fail to CHECK one, which is
 * why the api and the reader both check again. (packages/crypto does export a
 * generic Ed25519 sign(); it needs a secret key this side does not hold.)
 *
 * NO D1 BINDING, deliberately. The public read model has one writer (the api,
 * after re-verification). A console DO that wrote accountability_records directly
 * would be a second writer on the most consequential table in the schema, and the
 * bundle it wrote would never have passed the api's check.
 */
import { DurableObject } from 'cloudflare:workers';

/**
 * The seven §8.2 conditions as named bits.
 *
 * A BITMASK RATHER THAN SEVEN BOOLEAN COLUMNS OR A CHAIN OF `if`s, for one
 * reason: dropping a condition later has to be a visible deletion of a NAMED bit
 * from this object, which a reviewer of the diff will see. A loosened `if` in a
 * long function is invisible.
 */
export const CONDITIONS = {
	/** (1) Official-capacity fields only. Never home, family, or private life. */
	OFFICIAL_CAPACITY_ONLY: 1 << 0,
	/** (2) verification_state = Human-Verified. Layer-B only, never autonomous. */
	HUMAN_VERIFIED: 1 << 1,
	/** (3) Corroboration at or above the counsel-set floor. */
	CORROBORATED: 1 << 2,
	/** (5) A documentary anchor exists for the specific incident. */
	DOCUMENTARY_ANCHOR: 1 << 3,
	/** (6) The no-call-to-action classifier passed. */
	NO_CALL_TO_ACTION: 1 << 4,
	/** (7) A right-of-reply channel was offered and the SLA elapsed. */
	RIGHT_OF_REPLY: 1 << 5,
	/** (4) >=2 distinct reviewer role-key signatures. DERIVED, never asserted. */
	REVIEWER_QUORUM: 1 << 6
} as const;

export type ConditionName = keyof typeof CONDITIONS;

/** All seven. bundle() emits nothing until the mask equals this exactly. */
export const ALL_CONDITIONS =
	CONDITIONS.OFFICIAL_CAPACITY_ONLY |
	CONDITIONS.HUMAN_VERIFIED |
	CONDITIONS.CORROBORATED |
	CONDITIONS.DOCUMENTARY_ANCHOR |
	CONDITIONS.NO_CALL_TO_ACTION |
	CONDITIONS.RIGHT_OF_REPLY |
	CONDITIONS.REVIEWER_QUORUM;

/**
 * The six a human may assert. REVIEWER_QUORUM is absent on purpose.
 *
 * The quorum bit is computed from the signature table on every read, so nobody can
 * set it by hand — not a reviewer, not an operator, not a compelled console. It is
 * the one condition that cannot be asserted, only earned.
 */
export const ASSERTABLE_CONDITIONS = ALL_CONDITIONS & ~CONDITIONS.REVIEWER_QUORUM;

/** Signatures required over the identical canonical hash. */
export const QUORUM_REQUIRED = 2;

/**
 * The state machine. THERE IS NO PUBLISHED STATE.
 *
 * WITHHELD is the default and the resting place. READY means "every condition
 * holds and a bundle can be emitted", which is a statement about this record, not
 * a decision to publish it.
 */
export const GATE_STATES = ['WITHHELD', 'UNDER_REVIEW', 'READY', 'REJECTED', 'REMOVED'] as const;
export type GateState = (typeof GATE_STATES)[number];

export interface CandidateStatus {
	record_id: string;
	record_hash: string;
	state: GateState;
	/** Which conditions hold, including the derived quorum bit. */
	conditions: number;
	/** Names of the conditions still missing. Plain, for the operator surface. */
	missing: ConditionName[];
	signature_count: number;
	updated_hour: number;
}

/** What the api re-verifies. Public by construction: hashes and signatures. */
export interface QuorumBundle {
	record_id: string;
	record_hash: string;
	signatures: { key_id: string; sig: string }[];
	directory_epoch: number;
}

type CandidateRow = {
	[column: string]: SqlStorageValue;
	record_id: string;
	record_hash: string;
	conditions_mask: number;
	state: string;
	directory_epoch: number;
	updated_hour: number;
};

type SigRow = {
	[column: string]: SqlStorageValue;
	key_id: string;
	sig: string;
};

interface Env {
	FLAGS: KVNamespace;
}

/** Coarse hour bucket. NEVER a timestamp: a review minute is an activity trace. */
function hourOf(nowMs: number): number {
	return Math.floor(nowMs / 3_600_000);
}

export class ReviewGate extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS candidate (
				record_id TEXT PRIMARY KEY,
				record_hash TEXT NOT NULL,
				conditions_mask INTEGER NOT NULL DEFAULT 0,
				state TEXT NOT NULL DEFAULT 'WITHHELD',
				directory_epoch INTEGER NOT NULL DEFAULT 0,
				updated_hour INTEGER NOT NULL
			);
			CREATE TABLE IF NOT EXISTS sig (
				record_id TEXT NOT NULL,
				key_id TEXT NOT NULL,
				sig TEXT NOT NULL,
				signed_hash TEXT NOT NULL,
				PRIMARY KEY (record_id, key_id)
			);
		`);
	}

	/**
	 * Open a candidate. WITHHELD, mask zero.
	 *
	 * Re-opening an existing record with a DIFFERENT hash resets everything: the
	 * signatures were over the old bytes, and carrying them forward would let an
	 * editor change the record after it was signed. That is the whole attack a
	 * canonical hash exists to stop.
	 */
	open(input: { recordId: string; recordHash: string; directoryEpoch: number; nowMs?: number }) {
		const now = hourOf(input.nowMs ?? Date.now());
		const existing = this.row(input.recordId);
		if (existing && existing.record_hash !== input.recordHash) {
			this.ctx.storage.sql.exec('DELETE FROM sig WHERE record_id = ?', input.recordId);
			this.ctx.storage.sql.exec(
				`UPDATE candidate SET record_hash = ?, conditions_mask = 0, state = 'WITHHELD',
				 directory_epoch = ?, updated_hour = ? WHERE record_id = ?`,
				input.recordHash,
				input.directoryEpoch,
				now,
				input.recordId
			);
			return;
		}
		this.ctx.storage.sql.exec(
			`INSERT INTO candidate (record_id, record_hash, conditions_mask, state, directory_epoch, updated_hour)
			 VALUES (?, ?, 0, 'WITHHELD', ?, ?)
			 ON CONFLICT (record_id) DO NOTHING`,
			input.recordId,
			input.recordHash,
			input.directoryEpoch,
			now
		);
	}

	/**
	 * Assert one of the six human-assertable conditions.
	 *
	 * REVIEWER_QUORUM is rejected here, not ignored: silently dropping it would let
	 * a caller believe the quorum was recorded. It is derived on every read.
	 */
	assert(input: { recordId: string; condition: ConditionName; nowMs?: number }): boolean {
		const bit = CONDITIONS[input.condition];
		if ((bit & ASSERTABLE_CONDITIONS) === 0) return false;
		const row = this.row(input.recordId);
		if (!row || row.state === 'REMOVED' || row.state === 'REJECTED') return false;
		this.ctx.storage.sql.exec(
			`UPDATE candidate SET conditions_mask = conditions_mask | ?, state = 'UNDER_REVIEW',
			 updated_hour = ? WHERE record_id = ?`,
			bit,
			hourOf(input.nowMs ?? Date.now()),
			input.recordId
		);
		return true;
	}

	/**
	 * Record one reviewer signature.
	 *
	 * THE PRIMARY KEY (record_id, key_id) IS THE DISTINCTNESS RULE. One reviewer key
	 * cannot contribute two signatures toward a quorum of two, because the second
	 * write replaces the first rather than adding a row. Enforcing distinctness in a
	 * COUNT(DISTINCT) query instead would leave the table holding duplicates that
	 * some other query could count.
	 *
	 * A signature over the WRONG hash is refused rather than stored. §8.2 requires
	 * the signatures to be over the IDENTICAL canonical record hash; keeping a
	 * mismatched one would leave a row that looks like progress toward a quorum.
	 *
	 * This does NOT verify the signature — no Ed25519 verification runs in this DO
	 * and no public key is available to it. The api re-verifies the whole bundle
	 * against the pinned directory, and so does every reader.
	 */
	sign(input: {
		recordId: string;
		keyId: string;
		sig: string;
		signedHash: string;
		nowMs?: number;
	}): boolean {
		const row = this.row(input.recordId);
		if (!row || row.state === 'REMOVED' || row.state === 'REJECTED') return false;
		if (row.record_hash !== input.signedHash) return false;
		this.ctx.storage.sql.exec(
			`INSERT INTO sig (record_id, key_id, sig, signed_hash) VALUES (?, ?, ?, ?)
			 ON CONFLICT (record_id, key_id) DO UPDATE SET sig = excluded.sig, signed_hash = excluded.signed_hash`,
			input.recordId,
			input.keyId,
			input.sig,
			input.signedHash
		);
		this.ctx.storage.sql.exec(
			'UPDATE candidate SET updated_hour = ? WHERE record_id = ?',
			hourOf(input.nowMs ?? Date.now()),
			input.recordId
		);
		return true;
	}

	/**
	 * Withdraw one signature. Always allowed, for the same reason remove() is:
	 * a reviewer changing their mind must never be harder than signing.
	 */
	unsign(input: { recordId: string; keyId: string; nowMs?: number }): void {
		this.ctx.storage.sql.exec(
			'DELETE FROM sig WHERE record_id = ? AND key_id = ?',
			input.recordId,
			input.keyId
		);
		this.ctx.storage.sql.exec(
			'UPDATE candidate SET updated_hour = ? WHERE record_id = ?',
			hourOf(input.nowMs ?? Date.now()),
			input.recordId
		);
	}

	/**
	 * REMOVAL HAS NO CHECKS AT ALL, and that asymmetry is the design (§8.2).
	 *
	 * Publication is quorum-required and fails toward not-publishing; removal is
	 * single-reviewer and fails toward removal. So an infiltrated or coerced
	 * reviewer's maximum unilateral harm is SUPPRESSION of a record, never
	 * publication of a name. Suppression is the direction we accept.
	 *
	 * Do not add a condition here. A check on removal is a check that can fail while
	 * somebody is trying to take a name down.
	 */
	remove(input: { recordId: string; nowMs?: number }): void {
		this.ctx.storage.sql.exec(
			`UPDATE candidate SET state = 'REMOVED', updated_hour = ? WHERE record_id = ?`,
			hourOf(input.nowMs ?? Date.now()),
			input.recordId
		);
	}

	/** Reject a candidate outright. Same fail-safe direction as remove(). */
	reject(input: { recordId: string; nowMs?: number }): void {
		this.ctx.storage.sql.exec(
			`UPDATE candidate SET state = 'REJECTED', updated_hour = ? WHERE record_id = ?`,
			hourOf(input.nowMs ?? Date.now()),
			input.recordId
		);
	}

	/** Everything an operator surface needs, with the quorum bit derived. */
	status(recordId: string): CandidateStatus | null {
		const row = this.row(recordId);
		if (!row) return null;
		const sigs = this.signatures(recordId);
		const conditions = this.effectiveMask(row, sigs.length);
		const missing: ConditionName[] = [];
		for (const name of Object.keys(CONDITIONS) as ConditionName[]) {
			if ((conditions & CONDITIONS[name]) === 0) missing.push(name);
		}
		return {
			record_id: row.record_id,
			record_hash: row.record_hash,
			state: this.effectiveState(row, conditions),
			conditions,
			missing,
			signature_count: sigs.length,
			updated_hour: row.updated_hour
		};
	}

	/**
	 * The bundle the api re-verifies, or null.
	 *
	 * NULL UNLESS ALL SEVEN BITS HOLD. Returning a partial bundle "for the api to
	 * judge" would move the decision to whichever caller forgot to check, and the
	 * whole point of one hard predicate is that there is nowhere to forget.
	 */
	bundle(recordId: string): QuorumBundle | null {
		const row = this.row(recordId);
		if (!row) return null;
		if (row.state === 'REMOVED' || row.state === 'REJECTED') return null;
		const sigs = this.signatures(recordId);
		if (this.effectiveMask(row, sigs.length) !== ALL_CONDITIONS) return null;
		return {
			record_id: row.record_id,
			record_hash: row.record_hash,
			signatures: sigs.map((s) => ({ key_id: s.key_id, sig: s.sig })),
			directory_epoch: row.directory_epoch
		};
	}

	private row(recordId: string): CandidateRow | null {
		return (
			this.ctx.storage.sql
				.exec<CandidateRow>('SELECT * FROM candidate WHERE record_id = ?', recordId)
				.toArray()[0] ?? null
		);
	}

	/**
	 * The signatures on record, in key order.
	 *
	 * NO FILTER ON signed_hash, and its absence is deliberate. There were three
	 * mechanisms keeping stale signatures out of a quorum — open() deletes them when
	 * the hash changes, sign() refuses a mismatched one, and this query filtered on
	 * signed_hash. Sabotaging either of the first two left every test GREEN, because
	 * the other two still covered the property. That is the same shape as the M4
	 * reservation bug: redundant enforcement means no test isolates any single
	 * mechanism, so each one can rot unnoticed.
	 *
	 * The filter was the redundant one: if no stale row can be written (sign refuses)
	 * and none can survive an edit (open deletes), the WHERE clause can never exclude
	 * anything. Two mechanisms, each with its own test, each independently sabotaged
	 * red.
	 */
	private signatures(recordId: string): SigRow[] {
		return this.ctx.storage.sql
			.exec<SigRow>('SELECT key_id, sig FROM sig WHERE record_id = ? ORDER BY key_id', recordId)
			.toArray();
	}

	/** The stored mask plus the derived quorum bit. Never stored with the bit set. */
	private effectiveMask(row: CandidateRow, signatureCount: number): number {
		const asserted = row.conditions_mask & ASSERTABLE_CONDITIONS;
		return signatureCount >= QUORUM_REQUIRED ? asserted | CONDITIONS.REVIEWER_QUORUM : asserted;
	}

	/** READY is computed, never written, so it cannot be set without the conditions. */
	private effectiveState(row: CandidateRow, conditions: number): GateState {
		if (row.state === 'REMOVED' || row.state === 'REJECTED') return row.state;
		if (conditions === ALL_CONDITIONS) return 'READY';
		return row.state === 'UNDER_REVIEW' ? 'UNDER_REVIEW' : 'WITHHELD';
	}
}
