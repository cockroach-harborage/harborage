/**
 * Medical brokering vocabulary and medic tiers (PRD §4.7; ARCHITECTURE §5.3).
 *
 * TWO THINGS ARE DELIBERATELY ABSENT FROM THIS FILE, and both were tempting.
 *
 * 1. THERE IS NO TRIAGE IN THE ROUTING KEY. The obvious design is one Broker per
 *    (region, severity), which gives a Durable Object instance whose name means
 *    "the severely-injured queue for this district" and whose in-flight volume
 *    is a protest-intensity signal readable without opening anything. Severity
 *    never leaves the ciphertext: a polling medic pulls their region's sealed
 *    requests and sorts on their own device after decryption. Triage is a
 *    medic's job done on a medic's phone, and the platform has no business
 *    ranking injured people.
 *
 * 2. THERE IS NO COUNT OF INJURED PEOPLE. A number at a place is both an
 *    actionable figure for a responder and a crowd-intensity signal for anyone
 *    else, and the second use is available to more people than the first. Same
 *    argument as the capacity band.
 *
 * The need vocabulary is closed, low-literacy, and category-not-diagnosis. No
 * free text at all, not even a capped note: free text beside a life-safety
 * request is where a name, a landmark or a phone number ends up.
 */

/**
 * What is wrong, in words a frightened person recognises.
 *
 * Avoids clinical severity language (`critical`, `severe`) because the person
 * choosing is not a clinician, and avoids `panic` and `blur`, which are banned
 * across user copy anyway.
 */
export const MEDICAL_NEEDS = [
	'bleeding',
	'breathing',
	'burning',
	'head_injury',
	'limb_injury',
	'unconscious',
	'shock',
	'heat_or_water',
	'medicine',
	'other_urgent'
] as const;
export type MedicalNeed = (typeof MEDICAL_NEEDS)[number];

/** Three words, not a scale. A scale invites a number. */
export const MEDICAL_URGENCY = ['now', 'soon', 'today'] as const;
export type MedicalUrgency = (typeof MEDICAL_URGENCY)[number];

export const MEDICAL_WHO = ['me', 'someone_here'] as const;
export type MedicalWho = (typeof MEDICAL_WHO)[number];

/**
 * Medic tiers. BASIC is self-declared first aid; HIGH claims a registration a
 * vetting body checked.
 */
export const MEDIC_TIERS = ['unvetted', 'BASIC', 'HIGH'] as const;
export type MedicTier = (typeof MEDIC_TIERS)[number];

export interface VettingIssuer {
	/** Opaque issuer id, as it appears in a badge. */
	id: string;
	/** Ed25519 public key, hex. */
	publicKey: string;
}

/**
 * Vetting bodies whose badges are honoured.
 *
 * SHIPS EMPTY, and that is the switch-on gate made structural rather than
 * procedural, exactly as `PINNED_CUSTODIAN_KEYS` does for the evidence vault.
 * No verify-then-forget issuer exists yet, so `medicTier` returns 'unvetted' for
 * every badge, so every HIGH-tier acceptance refuses regardless of the flag.
 *
 * There is deliberately no configuration path that fills this at runtime. An
 * issuer is a jurisdiction assumption and a trust decision, not a setting.
 */
export const PINNED_VETTING_ISSUERS: readonly VettingIssuer[] = [];

/**
 * Does this badge come from a pinned issuer?
 *
 * Signature verification lives in the frozen crypto module; this decides only
 * whether anybody vouches for the issuer. `issuers` is a parameter so a test can
 * prove the verifier WORKS rather than merely that it refuses everything: an
 * always-false function passes every negative test and is indistinguishable
 * from a correct one without a positive control.
 */
export function isPinnedIssuer(
	issuerId: string,
	issuers: readonly VettingIssuer[] = PINNED_VETTING_ISSUERS
): boolean {
	return issuers.some((i) => i.id === issuerId);
}

/**
 * The tier a responder may claim.
 *
 * Unvetted today, always, because no issuer is pinned. Stated as a returned
 * value rather than a thrown error so the caller decides the posture: the
 * medical accept route refuses HIGH, and a BASIC responder is still allowed
 * through, because a first-aider who is present beats a doctor who is not.
 */
export function medicTier(
	badge: { issuerId: string; claimedTier: MedicTier } | null,
	issuers: readonly VettingIssuer[] = PINNED_VETTING_ISSUERS
): MedicTier {
	if (!badge) return 'unvetted';
	if (badge.claimedTier === 'HIGH' && !isPinnedIssuer(badge.issuerId, issuers)) return 'unvetted';
	if (badge.claimedTier === 'BASIC') return 'BASIC';
	return isPinnedIssuer(badge.issuerId, issuers) ? badge.claimedTier : 'unvetted';
}
