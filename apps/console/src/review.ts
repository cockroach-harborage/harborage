/**
 * Moderator review queue — the "third line" (ARCHITECTURE §15 Layer B).
 *
 * Layer A (AI + community) handles the reversible surface autonomously. This is
 * where a human takes over the high-stakes cases and operates the one state the
 * autonomous layer refuses to reach.
 *
 * THE TWO-SUBJECT RULE. `Human-Verified` is the only state carrying "Verified by
 * our team" and the top reach tier, so it is the one label a reader will act on.
 * It therefore requires TWO DISTINCT Access subjects: one reviewer stamps, a
 * different reviewer confirms.
 *
 * With a single maintainer that is unsatisfiable, and that is the correct
 * failure direction — publication must fail toward NOT publishing. The UI says
 * so plainly rather than hiding the control, because a greyed-out button with no
 * explanation invites someone to "fix" it later by removing the check.
 *
 * Quarantine RELEASE is single-reviewer by contrast, and the asymmetry is
 * deliberate: releasing restores something that already exists, while stamping
 * verified makes a claim to every reader. An infiltrated reviewer's maximum
 * unilateral harm is suppression, which is the accepted fail-safe direction.
 */
import type { D1Database } from '@cloudflare/workers-types';

/** Every state a reviewer may set. Note what is absent. */
export const REVIEWER_ACTIONS = [
	'release', // Quarantine-Pending -> Unverified. Single reviewer.
	'quarantine', // hide + retain. Single reviewer.
	'dispute', // mark contested. Single reviewer.
	'verify' // -> Human-Verified. TWO distinct subjects.
] as const;
export type ReviewerAction = (typeof REVIEWER_ACTIONS)[number];

/** Actions needing a second, distinct Access subject before they take effect. */
const TWO_PERSON: ReadonlySet<ReviewerAction> = new Set(['verify']);

export function requiresTwoPerson(action: ReviewerAction): boolean {
	return TWO_PERSON.has(action);
}

export interface QueueItem {
	item_id: string;
	item_kind: string;
	state: string;
	reach_milli: number;
	corroboration_count: number;
	dispute_count: number;
	is_directive: number;
	updated_bucket: string;
}

export interface PendingApproval {
	item_id: string;
	action: string;
	first_subject: string;
}

export type ReviewOutcome =
	| { kind: 'applied'; state: string }
	| { kind: 'awaiting-second'; action: ReviewerAction }
	| { kind: 'refused'; reason: string };

/**
 * The queue a reviewer works through.
 *
 * Ordered so the cases §15 says matter most come first: Disputed items with
 * high independent corroboration, then quarantines, then everything else. The
 * muddy-the-waters steady state is expected under attack, so the contested but
 * well-corroborated item must not end up buried under a flood of noise.
 */
export async function listQueue(db: D1Database, limit = 50): Promise<QueueItem[]> {
	const { results } = await db
		.prepare(
			`SELECT item_id, item_kind, state, reach_milli, corroboration_count,
			        dispute_count, is_directive, updated_bucket
			 FROM verification_states
			 WHERE state IN ('Disputed','Quarantine-Pending','Corroborating','AI-Screened')
			 ORDER BY
			   CASE state
			     WHEN 'Disputed' THEN 0
			     WHEN 'Quarantine-Pending' THEN 1
			     WHEN 'Corroborating' THEN 2
			     ELSE 3
			   END,
			   corroboration_count DESC,
			   updated_bucket ASC
			 LIMIT ?1`
		)
		.bind(limit)
		.all();
	return (results ?? []) as unknown as QueueItem[];
}

const TARGET_STATE: Record<ReviewerAction, string> = {
	release: 'Unverified',
	quarantine: 'Quarantine-Pending',
	dispute: 'Disputed',
	verify: 'Human-Verified'
};

export function isReviewerAction(value: string): value is ReviewerAction {
	return (REVIEWER_ACTIONS as readonly string[]).includes(value);
}

/**
 * Apply a reviewer decision.
 *
 * For a two-person action, the first distinct subject records an intent and
 * nothing changes; the SECOND distinct subject applies it. A repeat from the
 * same subject is refused, which is the whole point — otherwise one person
 * clicking twice satisfies a control designed to need two people.
 */
export async function applyReview(
	db: D1Database,
	itemId: string,
	action: ReviewerAction,
	subject: string,
	reason: string
): Promise<ReviewOutcome> {
	if (!reason.trim()) return { kind: 'refused', reason: 'a reason is required' };

	if (requiresTwoPerson(action)) {
		const existing = await db
			.prepare(
				'SELECT item_id, action, first_subject FROM review_approvals WHERE item_id = ?1 AND action = ?2'
			)
			.bind(itemId, action)
			.first<PendingApproval>();

		if (!existing) {
			await db
				.prepare(
					`INSERT INTO review_approvals (item_id, action, first_subject, at_bucket)
					 VALUES (?1, ?2, ?3, ?4) ON CONFLICT(item_id, action) DO NOTHING`
				)
				.bind(itemId, action, subject, dayBucket())
				.run();
			return { kind: 'awaiting-second', action };
		}
		if (existing.first_subject === subject) {
			// One person cannot be two people. This is the check, not a formality.
			return { kind: 'refused', reason: 'a second, different reviewer is required' };
		}
		await db.prepare('DELETE FROM review_approvals WHERE item_id = ?1 AND action = ?2')
			.bind(itemId, action)
			.run();
	}

	const state = TARGET_STATE[action];
	await db
		.prepare('UPDATE verification_states SET state = ?1, updated_bucket = ?2 WHERE item_id = ?3')
		.bind(state, dayBucket(), itemId)
		.run();

	// Non-content audit row. reviewer_ref is the opaque Access subject, never an
	// email, and at_bucket is a coarse day so this is not a record of exactly
	// when a particular reviewer acted.
	await db
		.prepare(
			`INSERT INTO mod_audit
				(opaque_id, category_code, action, actor_class, reviewer_ref, prior_state, new_state, reason_code, at_bucket)
			 VALUES (?1, 'review', ?2, 'human', ?3, NULL, ?4, ?5, ?6)`
		)
		.bind(
			itemId,
			action === 'quarantine' ? 'hide-pending' : action === 'release' ? 'retain-pending' : 'label',
			subject,
			state,
			reason.slice(0, 64),
			dayBucket()
		)
		.run();

	return { kind: 'applied', state };
}

function dayBucket(): string {
	return new Date().toISOString().slice(0, 10);
}
