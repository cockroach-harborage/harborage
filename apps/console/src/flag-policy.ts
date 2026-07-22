/**
 * Flag policy (CLAUDE.md Trust & Safety; ARCHITECTURE §10.3, §18.2).
 * Every flag fails closed. The irreversible high-harm gates ship LOCKED:
 * no code path can enable them — that is the "unsatisfiable quorum" made
 * literal. Unlocking any of them is a sensitive-path change requiring
 * maintainers + counsel and a staffed m-of-n human review org.
 */

/** Reversible feature flags an admin may flip from this console. */
export const FLIPPABLE = [
	'heightened_threat',
	'notices_publish',
	'directory_intake',
	'record_intake',
	'ai_moderation',
	'archive_anchoring'
] as const;

/** Irreversible high-harm gates: built, but permanently OFF at this milestone. */
export const LOCKED = [
	'accountability_naming',
	'evidence_unredaction',
	'precise_location_reveal',
	'permanent_delete'
] as const;

export type FlippableFlag = (typeof FLIPPABLE)[number];
export type LockedFlag = (typeof LOCKED)[number];

export function isFlippable(name: string): name is FlippableFlag {
	return (FLIPPABLE as readonly string[]).includes(name);
}

export function isLocked(name: string): name is LockedFlag {
	return (LOCKED as readonly string[]).includes(name);
}
