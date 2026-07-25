/**
 * The two-person rule, tested.
 *
 * `Human-Verified` is the only state carrying "Verified by our team" and the
 * top reach tier, so it is the one label a reader will act on. If one person
 * can reach it alone, the control is decorative.
 */
import { describe, expect, it, vi } from 'vitest';
import {
	REVIEWER_ACTIONS,
	applyReview,
	isReviewerAction,
	requiresTwoPerson
} from '../src/review.ts';

/** Minimal D1 stand-in: records statements and serves canned first() results. */
function fakeDb(first: unknown = null) {
	const statements: Array<{ sql: string; binds: unknown[] }> = [];
	let nextFirst = first;
	const db = {
		statements,
		setFirst(v: unknown) {
			nextFirst = v;
		},
		prepare(sql: string) {
			const entry = { sql, binds: [] as unknown[] };
			const stmt = {
				bind(...binds: unknown[]) {
					entry.binds = binds;
					statements.push(entry);
					return stmt;
				},
				async run() {
					return { success: true };
				},
				async all() {
					return { results: [] };
				},
				async first() {
					return nextFirst;
				}
			};
			return stmt;
		}
	};
	return db as unknown as Parameters<typeof applyReview>[0] & typeof db;
}

describe('the action set', () => {
	it('is closed and contains no irreversible verb', () => {
		expect([...REVIEWER_ACTIONS]).toEqual(['release', 'quarantine', 'dispute', 'verify']);
		for (const a of REVIEWER_ACTIONS) {
			expect(a).not.toMatch(/delete|publish|unredact|purge/i);
		}
	});

	it('rejects an unknown action rather than guessing', () => {
		expect(isReviewerAction('verify')).toBe(true);
		expect(isReviewerAction('DELETE')).toBe(false);
		expect(isReviewerAction('')).toBe(false);
	});
});

describe('verify needs two distinct reviewers', () => {
	it('only verify is two-person; removal stays single-reviewer', () => {
		expect(requiresTwoPerson('verify')).toBe(true);
		// The asymmetry is deliberate: an infiltrated reviewer's maximum
		// unilateral harm must be suppression, which is the safe direction.
		expect(requiresTwoPerson('release')).toBe(false);
		expect(requiresTwoPerson('quarantine')).toBe(false);
		expect(requiresTwoPerson('dispute')).toBe(false);
	});

	it('records an intent on the first reviewer and changes nothing', async () => {
		const db = fakeDb(null);
		const outcome = await applyReview(db, 'item-1', 'verify', 'subject-a', 'looks right');
		expect(outcome).toEqual({ kind: 'awaiting-second', action: 'verify' });
		// No state was written.
		expect(db.statements.some((s) => /UPDATE verification_states/.test(s.sql))).toBe(false);
	});

	// The whole control. One person clicking twice must not satisfy a rule
	// designed to need two people.
	it('refuses the same subject a second time', async () => {
		const db = fakeDb({ item_id: 'item-1', action: 'verify', first_subject: 'subject-a' });
		const outcome = await applyReview(db, 'item-1', 'verify', 'subject-a', 'still looks right');
		expect(outcome.kind).toBe('refused');
		expect(db.statements.some((s) => /UPDATE verification_states/.test(s.sql))).toBe(false);
	});

	it('applies when a genuinely different subject confirms', async () => {
		const db = fakeDb({ item_id: 'item-1', action: 'verify', first_subject: 'subject-a' });
		const outcome = await applyReview(db, 'item-1', 'verify', 'subject-b', 'confirmed');
		expect(outcome).toEqual({ kind: 'applied', state: 'Human-Verified' });
		expect(db.statements.some((s) => /UPDATE verification_states/.test(s.sql))).toBe(true);
		// And the intent is cleared so it cannot be replayed.
		expect(db.statements.some((s) => /DELETE FROM review_approvals/.test(s.sql))).toBe(true);
	});
});

describe('single-reviewer actions', () => {
	it('release applies immediately', async () => {
		const db = fakeDb(null);
		const outcome = await applyReview(db, 'item-1', 'release', 'subject-a', 'false positive');
		expect(outcome).toEqual({ kind: 'applied', state: 'Unverified' });
	});

	it('writes a non-content audit row with the opaque subject', async () => {
		const db = fakeDb(null);
		await applyReview(db, 'item-1', 'release', 'subject-a', 'false positive');
		const audit = db.statements.find((s) => /INSERT INTO mod_audit/.test(s.sql));
		expect(audit).toBeDefined();
		expect(audit!.binds).toContain('subject-a');
		// Coarse day bucket, never a precise instant: a precise one would record
		// exactly when a particular reviewer acted.
		expect(audit!.binds.some((b) => typeof b === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b))).toBe(
			true
		);
	});
});

describe('a reason is always required', () => {
	it('refuses an empty or whitespace reason, for every action', async () => {
		for (const action of REVIEWER_ACTIONS) {
			const db = fakeDb(null);
			expect((await applyReview(db, 'i', action, 'subject-a', '   ')).kind).toBe('refused');
			expect(db.statements.length).toBe(0);
		}
	});
});
