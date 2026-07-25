import { describe, expect, it } from 'vitest';
import {
	isPinnedIssuer,
	medicTier,
	MEDICAL_NEEDS,
	MEDICAL_URGENCY,
	MEDIC_TIERS,
	PINNED_VETTING_ISSUERS,
	type VettingIssuer
} from '../src/medical.ts';

const ISSUER: VettingIssuer = { id: 'bar-council-x', publicKey: 'ab'.repeat(32) };

describe('vetting issuers', () => {
	/**
	 * THE SWITCH-ON GATE, MADE STRUCTURAL. No issuer is pinned, so no badge can
	 * reach HIGH, so every HIGH-tier acceptance refuses regardless of the flag.
	 * Same pattern as PINNED_CUSTODIAN_KEYS: the thing that stops this shipping
	 * early is an empty array in source, not a setting someone can change.
	 */
	it('ships with no pinned issuer', () => {
		expect(PINNED_VETTING_ISSUERS).toHaveLength(0);
	});

	it('refuses a HIGH claim while no issuer is pinned', () => {
		expect(medicTier({ issuerId: 'bar-council-x', claimedTier: 'HIGH' })).toBe('unvetted');
	});

	/**
	 * THE NEGATIVE CONTROL, and without it the test above proves nothing. An
	 * always-'unvetted' function passes every refusal test and is
	 * indistinguishable from a working one. This is what says the verifier
	 * actually verifies, so "it refuses everything" is a fact about the empty
	 * issuer list rather than about a broken function.
	 */
	it('accepts a HIGH claim from an issuer that IS pinned', () => {
		expect(medicTier({ issuerId: ISSUER.id, claimedTier: 'HIGH' }, [ISSUER])).toBe('HIGH');
		expect(isPinnedIssuer(ISSUER.id, [ISSUER])).toBe(true);
		expect(isPinnedIssuer('someone-else', [ISSUER])).toBe(false);
	});

	/**
	 * BASIC is self-declared and stays reachable. A first-aider who is present
	 * beats a doctor who is not, so the empty issuer list must not close the
	 * whole responder path.
	 */
	it('lets a BASIC responder through with no issuer at all', () => {
		expect(medicTier({ issuerId: '', claimedTier: 'BASIC' })).toBe('BASIC');
	});

	it('treats an absent badge as unvetted', () => {
		expect(medicTier(null)).toBe('unvetted');
	});
});

describe('the vocabulary', () => {
	/**
	 * No count of injured people, anywhere. A number at a place is an actionable
	 * figure for a responder and a crowd-intensity signal for everyone else, and
	 * the second use is available to far more people than the first.
	 */
	it('has no field or value that could carry a headcount', () => {
		for (const v of [...MEDICAL_NEEDS, ...MEDICAL_URGENCY, ...MEDIC_TIERS]) {
			expect(v).not.toMatch(/count|number|how_many|\d/);
		}
	});

	/** Category, not diagnosis, and words a frightened person recognises. */
	it('avoids clinical severity language', () => {
		for (const v of MEDICAL_NEEDS) {
			expect(v).not.toMatch(/critical|severe|grade|triage|priority/);
		}
	});

	/** Banned across user copy, so banned in the enum that generates it. */
	it('uses no word gate-ai-tells forbids', () => {
		for (const v of [...MEDICAL_NEEDS, ...MEDICAL_URGENCY]) {
			expect(v).not.toMatch(/panic|blur|just|simply/);
		}
	});

	it('offers three urgency words rather than a scale', () => {
		expect([...MEDICAL_URGENCY]).toEqual(['now', 'soon', 'today']);
	});
});
