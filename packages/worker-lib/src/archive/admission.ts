/**
 * Fail-closed admission to the permanent public archive (ARCHITECTURE §16;
 * CLAUDE.md "Evidence Archive standards").
 *
 * The archive admits ONLY media that is verified AND human-confirmed redacted
 * AND non-radioactive AND optimized. Everything else is sealed-vault-only or
 * short-purged, and unverified content is never public and never amplified.
 *
 * WRITTEN AS A CONJUNCTION OF NAMED CONDITIONS, on purpose. The tempting shape
 * is a score or a sequence of early returns, and both make it easy to admit
 * something by accident: a score can be reached several ways, and an early
 * return that fires first hides every condition after it. Here every condition
 * is evaluated, every failure is named in `reasons`, and the default is
 * SEALED_ONLY. A caller passing a half-filled object gets SEALED_ONLY, not a
 * promotion it did not ask for.
 */

export type Admission = 'SEALED_ONLY' | 'CANDIDATE' | 'ADMITTED';

/** Only these two verification states may ever reach the public archive. */
export const ADMISSIBLE_STATES = ['Community-Corroborated', 'Human-Verified'] as const;

/**
 * Master states that satisfy the "optimized" condition.
 *
 * `skipped_oversize` counts, and that is deliberate rather than lax: the CLIENT
 * derivative already is the optimized public artifact (downscaled, re-encoded,
 * legibility-floored). The server master is an extra that saves bytes at scale,
 * so making admission depend on it would let a transform quota decide whether
 * evidence is publishable.
 */
export const MASTER_SATISFIED = ['built', 'skipped_oversize'] as const;

export interface AdmissionInput {
	verificationState: string;
	redactionConfirmed: boolean;
	radioactiveClear: boolean;
	derivativeSha256: string | null;
	masterState: string;
	archivePublishEnabled: boolean;
}

export interface AdmissionDecision {
	admission: Admission;
	reasons: string[];
}

export function admissionFor(input: AdmissionInput): AdmissionDecision {
	const reasons: string[] = [];

	if (!(ADMISSIBLE_STATES as readonly string[]).includes(input.verificationState)) {
		reasons.push('not_verified');
	}
	if (!input.redactionConfirmed) reasons.push('redaction_unconfirmed');
	if (!input.radioactiveClear) reasons.push('screen_not_clear');
	if (!input.derivativeSha256) reasons.push('no_public_derivative');
	if (!input.archivePublishEnabled) reasons.push('archive_publish_off');

	const masterPending = !(MASTER_SATISFIED as readonly string[]).includes(input.masterState);
	if (masterPending) reasons.push('master_pending');

	if (reasons.length === 0) return { admission: 'ADMITTED', reasons };

	// CANDIDATE means "everything a human or a policy decides is already true,
	// and only a machine step is outstanding". It is not a weaker form of
	// admission: nothing is published in this state.
	if (reasons.length === 1 && masterPending) return { admission: 'CANDIDATE', reasons };

	return { admission: 'SEALED_ONLY', reasons };
}
