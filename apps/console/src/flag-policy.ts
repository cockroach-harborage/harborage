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
	'document_intake',
	// Sealed originals leaving the device for the vault. Separate from
	// document_intake because the metadata register and the E2E original are
	// different custody classes: one the platform can read, one it cannot.
	// Switch-on additionally waits on a pinned off-platform custodian key, which
	// packages/crypto/vault-key.ts refuses to wrap without.
	'evidence_vault',
	'incidents_publish',
	'ai_moderation',
	// Community corroboration + reputation WRITES. Off means the tables stay at
	// zero rows: the schema exists so the code can be built and reviewed, and
	// switch-on additionally waits on blind-token-carried reputation so the
	// server holds no per-compartment list at all (§4.3).
	'community_corroborate',
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
