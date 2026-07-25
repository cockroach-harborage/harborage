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
	'archive_anchoring',
	// The permanent public archive. Off means admission never promotes past
	// SEALED_ONLY, no derivative is published, and the §63 export surface is
	// closed. Switch-on additionally waits on counsel signing off the certificate
	// form and the probation window length, neither of which a flag can supply.
	'archive_publish',
	// Fingerprint-and-reference of off-platform media. Built with no fetch path
	// at all, so flipping this stores a content id and a client fingerprint and
	// nothing else. Re-hosting is a separate, counsel-gated decision.
	'source_import',
	// The brokered mutual-aid channel. Off means every /api/aid/* route refuses
	// and no Broker or Mailbox instance is ever created. Flipping it is not
	// sufficient on its own: BROKER_INBOX_MAC_KEY is absent, so every brokered
	// route refuses for everyone regardless, which is the correct resting state
	// until a broker is actually operated.
	'aid_broker',
	// The brokered medical channel. Flipping it is not sufficient on its own:
	// every route refuses over clearnet until an onion origin is operated, and
	// BROKER_INBOX_MAC_KEY is absent. Deliberately NOT closed by heightened
	// threat, unlike every other write flag (maintainer decision, 2026-07-26):
	// the onion requirement is the stronger gate, and this platform offers no
	// state emergency number to fall back to.
	'medical_broker',
	// Helper offers and the published capacity band. Switch-on additionally waits
	// on a vetting issuer existing, which packages/worker-lib/medical.ts refuses
	// to supply while PINNED_VETTING_ISSUERS is empty, so every HIGH-tier offer
	// refuses regardless of this flag.
	'helper_registry',
	// The zone-level live board. Switch-on additionally waits on the §6.4
	// parameters being signed off by counsel and on live_zones holding a signed
	// row, neither of which a flag can supply: with zero active zones every
	// ingest refuses regardless.
	'live_board',
	// Crowd bands only, separate so they can be dropped without closing the
	// hazard board. Disabled entirely under heightened threat.
	'crowd_bands',
	// The public institutional accountability surface. Reversible: switching it off
	// hides published records, it does not unpublish or delete them.
	'accountability_records'
] as const;

/** Irreversible high-harm gates: built, but permanently OFF at this milestone. */
export const LOCKED = [
	'accountability_naming',
	'evidence_unredaction',
	'precise_location_reveal',
	'permanent_delete',
	// Detainee and incommunicado tracking. LOCKED HERE ONLY, and deliberately
	// absent from FLAG_NAMES: a locked gate must have no runtime read path at all,
	// so flagEnabled(kv, 'detainee_intake') does not typecheck and the route cannot
	// be written to consult it. The console lists them so an operator can SEE they
	// exist and are locked, which is the only reason a name appears here.
	//
	// Both are counsel-gated beyond the flag (§8.3: whether any detainee field may
	// transit the platform even transiently), and incommunicado additionally needs
	// two authenticated legal-compartment triggers plus a legal_broker role
	// signature from a key_directory that ships empty.
	'detainee_intake',
	'incommunicado_alert'
] as const;

export type FlippableFlag = (typeof FLIPPABLE)[number];
export type LockedFlag = (typeof LOCKED)[number];

export function isFlippable(name: string): name is FlippableFlag {
	return (FLIPPABLE as readonly string[]).includes(name);
}

export function isLocked(name: string): name is LockedFlag {
	return (LOCKED as readonly string[]).includes(name);
}
