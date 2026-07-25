/**
 * The probation window before an item is treated as settled (ARCHITECTURE §16).
 *
 * A newly admitted object stays fully removable for 30-90 days (counsel sets the
 * exact figure) and is continuously re-scanned against rolling known-bad lists
 * and updated lexicons. Nothing durable is applied before the window clears,
 * because durability applied before certainty turns a detection miss into
 * content that can never be taken down.
 *
 * THE STATE SET HAS THREE MEMBERS AND NONE OF THEM MEANS SETTLED FOREVER. There
 * is deliberately no terminal state: CLEARED means the window elapsed with
 * nothing found, and an item can still be withdrawn afterwards. A fourth value
 * meaning "beyond reach" is the thing §16 refuses to build.
 */

export const PROBATION_MIN_DAYS = 30;
export const PROBATION_MAX_DAYS = 90;
/**
 * Fail LONG. Certainty about a piece of media grows with time and with the
 * arrival of new known-bad lists, so the safe default when nobody has set a
 * figure is the longest window, not the shortest.
 */
export const DEFAULT_PROBATION_DAYS = PROBATION_MAX_DAYS;
export const RESCAN_INTERVAL_DAYS = 7;

export type ProbationState = 'OPEN' | 'CLEARED' | 'HELD';

export interface ProbationInput {
	state: ProbationState;
	createdBucket: string;
	todayBucket: string;
	rescanHit: boolean;
	openDisputes: number;
	windowDays?: number;
}

export interface ProbationDecision {
	state: ProbationState;
	nextDueBucket: string | null;
	reasons: string[];
}

/** Whole days between two YYYY-MM-DD buckets. Negative clamps to 0. */
export function daysBetweenBuckets(from: string, to: string): number {
	const a = Date.parse(`${from}T00:00:00Z`);
	const b = Date.parse(`${to}T00:00:00Z`);
	if (Number.isNaN(a) || Number.isNaN(b)) throw new Error('bucket must be YYYY-MM-DD');
	return Math.max(0, Math.round((b - a) / 86_400_000));
}

function addDays(bucket: string, days: number): string {
	const t = Date.parse(`${bucket}T00:00:00Z`) + days * 86_400_000;
	return new Date(t).toISOString().slice(0, 10);
}

export function advanceProbation(input: ProbationInput): ProbationDecision {
	const windowDays = input.windowDays ?? DEFAULT_PROBATION_DAYS;
	const reasons: string[] = [];

	// HELD is a one-way door for the autonomous path. Something matched a
	// known-bad list, and only a human may decide that was wrong. Auto-clearing
	// out of HELD would let a transient list update launder a real hit.
	if (input.state === 'HELD') {
		return { state: 'HELD', nextDueBucket: null, reasons: ['held_awaiting_human'] };
	}
	if (input.rescanHit) {
		return { state: 'HELD', nextDueBucket: null, reasons: ['rescan_hit'] };
	}
	if (input.state === 'CLEARED') {
		return { state: 'CLEARED', nextDueBucket: null, reasons: ['already_cleared'] };
	}

	const elapsed = daysBetweenBuckets(input.createdBucket, input.todayBucket);
	if (elapsed < windowDays) {
		reasons.push('window_open');
		return {
			state: 'OPEN',
			nextDueBucket: addDays(input.todayBucket, RESCAN_INTERVAL_DAYS),
			reasons
		};
	}
	// An open objection outlasts the clock. Clearing an item somebody has
	// documented an objection to, purely because a timer elapsed, is how a
	// challenged item quietly becomes settled.
	if (input.openDisputes > 0) {
		reasons.push('dispute_open');
		return {
			state: 'OPEN',
			nextDueBucket: addDays(input.todayBucket, RESCAN_INTERVAL_DAYS),
			reasons
		};
	}
	reasons.push('window_elapsed_clean');
	return { state: 'CLEARED', nextDueBucket: null, reasons };
}
