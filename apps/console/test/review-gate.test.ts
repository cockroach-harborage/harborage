/**
 * The Naming Review gate (ARCHITECTURE §8.2), the strictest state machine in the
 * repo. Every test here is a way a name could reach the public that must not.
 *
 * WHY THIS HARNESS USES REAL SQLITE. The existing DO tests hand-roll a small SQL
 * matcher, which is fine when the claims are about the DO's arithmetic. It is NOT
 * fine here, because ReviewGate's load-bearing claim is that
 * `PRIMARY KEY (record_id, key_id)` IS the distinctness rule — one reviewer key
 * cannot contribute two signatures toward a quorum of two. A hand-written engine
 * backed by a Map would enforce that with MY code, so the test would prove
 * nothing about the schema, which is the thing being relied on. node:sqlite runs
 * the actual CREATE TABLE and the actual ON CONFLICT, so the constraint is what
 * is under test.
 */
import { sqliteCtx } from './stubs/sqlite-ctx.mjs';
import { describe, expect, it } from 'vitest';
import {
	ALL_CONDITIONS,
	ASSERTABLE_CONDITIONS,
	CONDITIONS,
	QUORUM_REQUIRED,
	ReviewGate,
	type ConditionName
} from '../src/do/ReviewGate.ts';

const REC = 'rec_01HQ';
const HASH = 'a'.repeat(64);
const OTHER_HASH = 'b'.repeat(64);
const NOW = 1_785_000_000_000;

/** The six a human may assert; the seventh is earned, not set. */
const ASSERTABLE: ConditionName[] = [
	'OFFICIAL_CAPACITY_ONLY',
	'HUMAN_VERIFIED',
	'CORROBORATED',
	'DOCUMENTARY_ANCHOR',
	'NO_CALL_TO_ACTION',
	'RIGHT_OF_REPLY'
];

/**
 * A ReviewGate over a real in-memory SQLite. The harness lives in
 * stubs/sqlite-ctx.mjs; its docstring explains why that file is .mjs.
 */
function newGate(): ReviewGate {
	return new ReviewGate(sqliteCtx(), { FLAGS: {} as KVNamespace });
}

/** Open a candidate and assert every human-assertable condition. */
function readyExceptQuorum(gate: ReviewGate) {
	gate.open({ recordId: REC, recordHash: HASH, directoryEpoch: 7, nowMs: NOW });
	for (const c of ASSERTABLE) gate.assert({ recordId: REC, condition: c, nowMs: NOW });
}

function sign(gate: ReviewGate, keyId: string, hash = HASH) {
	return gate.sign({ recordId: REC, keyId, sig: `sig-${keyId}`, signedHash: hash, nowMs: NOW });
}

describe('there is no published state anywhere in this object', () => {
	/**
	 * THE STRUCTURAL CLAIM, asserted over the module's own exports rather than left
	 * to review. This DO collects; it cannot publish. Publication is a separate act
	 * by the api after re-verifying the bundle, and the reader verifies again.
	 */
	it('exports no state or condition that means published', async () => {
		const mod = await import('../src/do/ReviewGate.ts');
		const states = (mod.GATE_STATES as readonly string[]).join(',');
		expect(states).not.toMatch(/PUBLISH|PUBLIC|LIVE|VISIBLE|NAMED|SHOWN|RELEASED/i);
		for (const name of Object.keys(mod.CONDITIONS)) expect(name).not.toMatch(/PUBLISH|RELEASE/i);
		for (const name of Object.keys(mod))
			expect(name).not.toMatch(/^publish|^release|^reveal|^name(?!Of)/i);
	});

	/** The terminal positive state is READY: a statement about the record, not a decision. */
	it('reaches READY and no further', () => {
		const gate = newGate();
		readyExceptQuorum(gate);
		sign(gate, 'k1');
		sign(gate, 'k2');
		expect(gate.status(REC)?.state).toBe('READY');
	});
});

describe('the quorum bit is earned, never asserted', () => {
	/**
	 * The one condition nobody can set by hand — not a reviewer, not an operator,
	 * not a compelled console. It is recomputed from the signature table on every
	 * read.
	 */
	it('refuses an attempt to assert REVIEWER_QUORUM', () => {
		const gate = newGate();
		readyExceptQuorum(gate);
		expect(gate.assert({ recordId: REC, condition: 'REVIEWER_QUORUM', nowMs: NOW })).toBe(false);
		expect(gate.bundle(REC)).toBeNull();
		expect(gate.status(REC)?.missing).toEqual(['REVIEWER_QUORUM']);
	});

	/** Refused, not silently ignored: a dropped write reads as a recorded one. */
	it('keeps REVIEWER_QUORUM out of the assertable set', () => {
		expect(ASSERTABLE_CONDITIONS & CONDITIONS.REVIEWER_QUORUM).toBe(0);
		expect(ALL_CONDITIONS & CONDITIONS.REVIEWER_QUORUM).toBe(CONDITIONS.REVIEWER_QUORUM);
	});

	it('sets the bit at exactly the quorum and not before', () => {
		const gate = newGate();
		readyExceptQuorum(gate);
		expect(gate.bundle(REC)).toBeNull();
		sign(gate, 'k1');
		expect(gate.status(REC)?.signature_count).toBe(1);
		expect(gate.bundle(REC), 'one signature is not a quorum').toBeNull();
		sign(gate, 'k2');
		expect(gate.bundle(REC)?.signatures).toHaveLength(QUORUM_REQUIRED);
	});
});

describe('the PRIMARY KEY is the distinctness rule', () => {
	/**
	 * THE TEST THIS FILE EXISTS FOR, and the reason the harness runs real SQLite.
	 * One reviewer signing twice must not satisfy a quorum of two. Enforced by the
	 * composite PRIMARY KEY, so the second write REPLACES the first rather than
	 * adding a row — there are no duplicates left in the table for some other query
	 * to count.
	 */
	it('does not let one key sign its way to a quorum', () => {
		const gate = newGate();
		readyExceptQuorum(gate);
		sign(gate, 'k1');
		gate.sign({ recordId: REC, keyId: 'k1', sig: 'different', signedHash: HASH, nowMs: NOW });
		gate.sign({ recordId: REC, keyId: 'k1', sig: 'again', signedHash: HASH, nowMs: NOW });
		expect(gate.status(REC)?.signature_count).toBe(1);
		expect(gate.bundle(REC)).toBeNull();
	});

	it('counts two distinct keys as two', () => {
		const gate = newGate();
		readyExceptQuorum(gate);
		sign(gate, 'k1');
		sign(gate, 'k2');
		expect(gate.status(REC)?.signature_count).toBe(2);
		expect(gate.bundle(REC)?.signatures.map((s) => s.key_id)).toEqual(['k1', 'k2']);
	});

	/** A reviewer changing their mind is never harder than signing. */
	it('drops back below the quorum when a signature is withdrawn', () => {
		const gate = newGate();
		readyExceptQuorum(gate);
		sign(gate, 'k1');
		sign(gate, 'k2');
		expect(gate.bundle(REC)).not.toBeNull();
		gate.unsign({ recordId: REC, keyId: 'k2', nowMs: NOW });
		expect(gate.bundle(REC)).toBeNull();
		expect(gate.status(REC)?.state).toBe('UNDER_REVIEW');
	});
});

describe('signatures are bound to the exact bytes', () => {
	/**
	 * §8.2 requires the signatures to be over the IDENTICAL canonical record hash.
	 * A signature over other bytes is REFUSED rather than stored: a stored
	 * mismatched row looks like progress toward a quorum.
	 */
	it('refuses a signature over a different hash', () => {
		const gate = newGate();
		readyExceptQuorum(gate);
		expect(sign(gate, 'k1', OTHER_HASH)).toBe(false);
		expect(gate.status(REC)?.signature_count).toBe(0);
	});

	/**
	 * THE EDIT-AFTER-SIGNING ATTACK. Re-opening with different bytes discards every
	 * signature and every asserted condition, because those attested to the old
	 * record. Carrying them forward is exactly what a canonical hash exists to stop.
	 */
	it('discards signatures and conditions when the record changes', () => {
		const gate = newGate();
		readyExceptQuorum(gate);
		sign(gate, 'k1');
		sign(gate, 'k2');
		expect(gate.bundle(REC)).not.toBeNull();

		gate.open({ recordId: REC, recordHash: OTHER_HASH, directoryEpoch: 7, nowMs: NOW });
		const after = gate.status(REC);
		expect(after?.signature_count).toBe(0);
		expect(after?.conditions).toBe(0);
		expect(after?.state).toBe('WITHHELD');
		expect(gate.bundle(REC)).toBeNull();
	});

	/** Re-opening with the SAME bytes is idempotent and loses nothing. */
	it('leaves an unchanged record alone when re-opened', () => {
		const gate = newGate();
		readyExceptQuorum(gate);
		sign(gate, 'k1');
		sign(gate, 'k2');
		gate.open({ recordId: REC, recordHash: HASH, directoryEpoch: 7, nowMs: NOW });
		expect(gate.bundle(REC)?.signatures).toHaveLength(2);
	});
});

describe('every one of the seven conditions is load-bearing', () => {
	/**
	 * Each condition dropped in turn, one at a time. A single test asserting "all
	 * seven required" passes if the predicate is `mask !== 0`, so the property is
	 * checked once per condition instead.
	 */
	it('emits no bundle with any single condition missing', () => {
		for (const omitted of ASSERTABLE) {
			const gate = newGate();
			gate.open({ recordId: REC, recordHash: HASH, directoryEpoch: 7, nowMs: NOW });
			for (const c of ASSERTABLE)
				if (c !== omitted) gate.assert({ recordId: REC, condition: c, nowMs: NOW });
			sign(gate, 'k1');
			sign(gate, 'k2');
			expect(gate.bundle(REC), `missing ${omitted}`).toBeNull();
			expect(gate.status(REC)?.missing, `missing ${omitted}`).toEqual([omitted]);
		}
	});

	/** The positive control, or "emits no bundle" could mean "never emits one". */
	it('emits a bundle when all seven hold', () => {
		const gate = newGate();
		readyExceptQuorum(gate);
		sign(gate, 'k1');
		sign(gate, 'k2');
		const bundle = gate.bundle(REC);
		expect(bundle).not.toBeNull();
		expect(bundle?.record_hash).toBe(HASH);
		expect(bundle?.directory_epoch).toBe(7);
		expect(gate.status(REC)?.missing).toEqual([]);
	});

	/**
	 * The autonomous ceiling. HUMAN_VERIFIED is a named condition somebody has to
	 * assert; there is no path by which a Community-Corroborated verdict sets it,
	 * because the only writer is assert() and the only caller is a human surface.
	 */
	it('requires HUMAN_VERIFIED as its own condition', () => {
		expect(ALL_CONDITIONS & CONDITIONS.HUMAN_VERIFIED).toBe(CONDITIONS.HUMAN_VERIFIED);
		const gate = newGate();
		gate.open({ recordId: REC, recordHash: HASH, directoryEpoch: 7, nowMs: NOW });
		for (const c of ASSERTABLE)
			if (c !== 'HUMAN_VERIFIED') gate.assert({ recordId: REC, condition: c, nowMs: NOW });
		sign(gate, 'k1');
		sign(gate, 'k2');
		expect(gate.bundle(REC)).toBeNull();
	});
});

describe('removal fails toward removal', () => {
	/**
	 * THE ASYMMETRY IS THE DESIGN (§8.2). Publication is quorum-required and fails
	 * toward not-publishing; removal is single-reviewer and fails toward removal. So
	 * an infiltrated or coerced reviewer's maximum unilateral harm is SUPPRESSION,
	 * never publication of a name — and suppression is the direction we accept.
	 */
	it('removes a fully-ready record with no checks at all', () => {
		const gate = newGate();
		readyExceptQuorum(gate);
		sign(gate, 'k1');
		sign(gate, 'k2');
		expect(gate.bundle(REC)).not.toBeNull();
		gate.remove({ recordId: REC, nowMs: NOW });
		expect(gate.status(REC)?.state).toBe('REMOVED');
		expect(gate.bundle(REC)).toBeNull();
	});

	/** Removal of something that was never opened is not an error either. */
	it('does not throw removing an unknown record', () => {
		const gate = newGate();
		expect(() => gate.remove({ recordId: 'nope', nowMs: NOW })).not.toThrow();
	});

	/** A removed or rejected record is inert: no new signature, no new condition. */
	it('accepts nothing further once removed or rejected', () => {
		for (const kill of ['remove', 'reject'] as const) {
			const gate = newGate();
			readyExceptQuorum(gate);
			gate[kill]({ recordId: REC, nowMs: NOW });
			expect(sign(gate, 'k1'), kill).toBe(false);
			expect(gate.assert({ recordId: REC, condition: 'HUMAN_VERIFIED', nowMs: NOW }), kill).toBe(
				false
			);
			expect(gate.bundle(REC), kill).toBeNull();
		}
	});
});

describe('nothing here is a timestamp', () => {
	/**
	 * A review MINUTE is an activity trace: it says when a named reviewer was
	 * working, and DO SQLite has a 30-day PITR window that cannot be disabled. Hours
	 * are coarse enough to be useless for that and precise enough to order events.
	 */
	it('records a coarse hour, not a time', () => {
		// Aligned to an hour boundary on purpose. The first version of this test used
		// an arbitrary NOW and asserted "two events 59 minutes apart are
		// indistinguishable", which is simply false: 59 minutes can straddle a
		// boundary. The true property is that minute precision is DISCARDED, so two
		// events within one hour share a bucket — which needs an aligned base to
		// state, and needs the complementary case below to be worth anything.
		const base = Math.floor(NOW / 3_600_000) * 3_600_000;
		const gate = newGate();
		gate.open({ recordId: REC, recordHash: HASH, directoryEpoch: 7, nowMs: base });
		const hour = gate.status(REC)?.updated_hour ?? 0;
		expect(hour).toBe(base / 3_600_000);

		gate.assert({ recordId: REC, condition: 'HUMAN_VERIFIED', nowMs: base + 59 * 60_000 });
		expect(gate.status(REC)?.updated_hour, 'same hour, same bucket').toBe(hour);

		// And the field is not frozen: the next hour is a different bucket, so events
		// can still be ordered coarsely.
		gate.assert({ recordId: REC, condition: 'CORROBORATED', nowMs: base + 61 * 60_000 });
		expect(gate.status(REC)?.updated_hour).toBe(hour + 1);
	});

	/** No exported field or method name suggests a reviewer identity. */
	it('exposes no reviewer identity, only key ids', async () => {
		const gate = newGate();
		readyExceptQuorum(gate);
		sign(gate, 'k1');
		sign(gate, 'k2');
		const serialized = JSON.stringify({ s: gate.status(REC), b: gate.bundle(REC) });
		expect(serialized).not.toMatch(/name|email|phone|device|ip|reviewer_id/i);
	});
});

describe('an unknown record is not a half-open one', () => {
	it('returns null status and null bundle for a record never opened', () => {
		const gate = newGate();
		expect(gate.status('nope')).toBeNull();
		expect(gate.bundle('nope')).toBeNull();
	});

	it('refuses to assert or sign against a record never opened', () => {
		const gate = newGate();
		expect(gate.assert({ recordId: 'nope', condition: 'HUMAN_VERIFIED', nowMs: NOW })).toBe(false);
		expect(gate.sign({ recordId: 'nope', keyId: 'k', sig: 's', signedHash: HASH })).toBe(false);
	});
});
