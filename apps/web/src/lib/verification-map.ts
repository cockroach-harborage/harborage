/**
 * Internal verification state -> public label kind.
 *
 * Deliberately free of any import, so it is unit-testable with bare vitest and
 * so the M2 state-machine conformance test can drive it directly. The
 * paraglide-backed rendering lives in verification.ts.
 *
 * The four public labels are the whole vocabulary a reader ever meets (PRD §15).
 * Mapping an internal state UP to a stronger label is not a cosmetic slip, it is
 * a truth-and-anti-manipulation failure: the label is the entire basis on which
 * someone decides whether to act on a report.
 */
export type LabelKind = 'team' | 'nearby' | 'unchecked' | 'problem';

/**
 * The canonical §15 machine. Listed explicitly so a state added later without a
 * mapping is caught by the conformance test rather than silently defaulting.
 */
export const INCIDENT_STATES = [
	'Unverified',
	'AI-Screened',
	'Corroborating',
	'Community-Corroborated',
	'Human-Verified',
	'Disputed',
	'Debunked',
	'Quarantine-Pending'
] as const;
export type IncidentState = (typeof INCIDENT_STATES)[number];

/**
 * Incident verification_state -> public label kind (ARCHITECTURE §18.1, which is
 * authoritative over the older §15 badge text).
 *
 * `Corroborating` maps to "not checked yet", NOT to "confirmed by people
 * nearby". It clears a far weaker bar than `Community-Corroborated` — two
 * corroborators and a 15-minute dwell, versus K=4 across three independence
 * buckets, a 60-minute dwell, a cross-compartment anchor and AI concurrence.
 * Presenting it as confirmed would over-claim by design.
 *
 * `Quarantine-Pending` is hidden (reach 0) and never reaches a reader; it maps
 * to the weakest label so that any future leak under-claims rather than over-claims.
 *
 * Unknown states fall to `unchecked` for the same reason: the safe direction is
 * always to promise less.
 */
export function incidentLabelKind(state: string): LabelKind {
	if (state === 'Human-Verified') return 'team';
	if (state === 'Community-Corroborated') return 'nearby';
	if (state === 'Disputed' || state === 'Debunked') return 'problem';
	return 'unchecked';
}

/**
 * Directory entries run a SEPARATE ladder (PRD §14.5): SelfListed /
 * Corroborating / Verified / Signed / Stale / Quarantined. Do not merge it with
 * the incident machine — here `Corroborating` genuinely is the community-checked
 * tier, so it correctly maps to "confirmed by people nearby".
 */
export const DIRECTORY_STATES = [
	'SelfListed',
	'Corroborating',
	'Verified',
	'Signed',
	'Stale',
	'Quarantined'
] as const;
export type DirectoryState = (typeof DIRECTORY_STATES)[number];

export function directoryLabelKind(state: string): LabelKind {
	if (state === 'Signed' || state === 'Verified') return 'team';
	if (state === 'Corroborating') return 'nearby';
	if (state === 'Quarantined') return 'problem';
	return 'unchecked'; // SelfListed, Stale
}
