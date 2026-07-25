/**
 * Cohort guards that stop a low-popularity item becoming a timing oracle
 * (ARCHITECTURE §7.3, §16).
 *
 * Two places need the same shape of protection.
 *
 * DEDUP. Answering "do you already hold this derivative?" is an existence
 * oracle when the answer is about one obscure file: whoever asks learns whether
 * a specific picture has been archived, and for a singleton that is a fact about
 * one contributor. So the answer is `upload` until a cohort of at least K
 * distinct holders exists, which costs a redundant upload and buys the absence
 * of the oracle. Note this covers PUBLIC derivatives only -- there is no code
 * path that asks about a sealed original at all, and convergent encryption is
 * rejected outright for exactly this reason.
 *
 * CHECKPOINT INCLUSION. An external anchor with a precise time is a
 * deanonymization oracle against a singleton submitter: if one item enters one
 * checkpoint alone, the anchor timestamps that submission. An item enters only
 * once it joins a cohort of at least K, or a randomized delay elapses, so the
 * anchor never resolves to one submission.
 */

export const DEDUP_COHORT_K = 5;
export const CHECKPOINT_COHORT_K = 8;
/** Ceiling on how long a lonely item may wait for company. */
export const CHECKPOINT_MAX_DELAY_MS = 26 * 60 * 60_000;
const CHECKPOINT_MIN_DELAY_MS = 2 * 60 * 60_000;

/**
 * `skip` means "we already hold it, do not spend the bytes". It is returned ONLY
 * once the cohort threshold is met, so a singleton always gets `upload` and
 * therefore learns nothing.
 */
export function dedupVerdict(seenCount: number, k: number = DEDUP_COHORT_K): 'skip' | 'upload' {
	if (!Number.isFinite(seenCount) || seenCount < k) return 'upload';
	return 'skip';
}

export interface CheckpointReadiness {
	pending: number;
	oldestPendingMs: number;
	nowMs: number;
	k?: number;
	maxDelayMs?: number;
}

export function checkpointReady(input: CheckpointReadiness): boolean {
	const k = input.k ?? CHECKPOINT_COHORT_K;
	const maxDelay = input.maxDelayMs ?? CHECKPOINT_MAX_DELAY_MS;
	if (input.pending <= 0) return false;
	if (input.pending >= k) return true;
	return input.nowMs - input.oldestPendingMs >= maxDelay;
}

/**
 * How long a single item waits before it may be folded in, when no cohort
 * arrives. Randomized rather than fixed: a fixed delay is just the submission
 * time plus a constant, which is the same oracle with an offset.
 */
export function randomizedInclusionDelayMs(rand: () => number): number {
	const span = CHECKPOINT_MAX_DELAY_MS - CHECKPOINT_MIN_DELAY_MS;
	return CHECKPOINT_MIN_DELAY_MS + Math.floor(rand() * span);
}
