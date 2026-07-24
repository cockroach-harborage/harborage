import { describe, expect, it } from 'vitest';
import {
	DIRECTORY_STATES,
	INCIDENT_STATES,
	directoryLabelKind,
	incidentLabelKind,
	type LabelKind
} from '../src/lib/verification-map.ts';

// The public label is the entire basis on which a reader decides whether to act
// on a report, so over-claiming is a safety bug, not a copy bug. These are
// conformance tests against ARCHITECTURE §18.1, not characterisation tests: if
// the mapping changes, one of these must be consciously updated.

const STRONGER_THAN_UNCHECKED: LabelKind[] = ['team', 'nearby'];

describe('incident state -> public label', () => {
	it('gives "verified by our team" to human review and nothing else', () => {
		const team = INCIDENT_STATES.filter((s) => incidentLabelKind(s) === 'team');
		expect(team).toEqual(['Human-Verified']);
	});

	it('gives "confirmed by people nearby" to Community-Corroborated and nothing else', () => {
		const nearby = INCIDENT_STATES.filter((s) => incidentLabelKind(s) === 'nearby');
		expect(nearby).toEqual(['Community-Corroborated']);
	});

	it('does NOT present Corroborating as confirmed', () => {
		// Two corroborators and a 15-minute dwell, versus K=4 across three
		// independence buckets plus AI concurrence for Community-Corroborated.
		expect(incidentLabelKind('Corroborating')).toBe('unchecked');
	});

	it('does not let an autonomous state reach the team label', () => {
		// The autonomous ceiling is Community-Corroborated; only Layer B confers
		// "verified by our team".
		for (const state of INCIDENT_STATES) {
			if (state === 'Human-Verified') continue;
			expect(incidentLabelKind(state), state).not.toBe('team');
		}
	});

	it('flags contested states as a problem', () => {
		expect(incidentLabelKind('Disputed')).toBe('problem');
		expect(incidentLabelKind('Debunked')).toBe('problem');
	});

	it('under-claims for hidden and unknown states', () => {
		// Quarantine-Pending is hidden and should never render; if it ever leaks,
		// it must leak as the weakest label, never a stronger one.
		expect(incidentLabelKind('Quarantine-Pending')).toBe('unchecked');
		// A state added to the machine without a mapping must not inherit trust.
		expect(incidentLabelKind('Some-Future-State')).toBe('unchecked');
		expect(incidentLabelKind('')).toBe('unchecked');
		// 'Verified' is retired vocabulary (§18.1); it must not read as team-verified.
		expect(incidentLabelKind('Verified')).toBe('unchecked');
	});

	it('maps every canonical state to one of the four labels', () => {
		for (const state of INCIDENT_STATES) {
			expect(['team', 'nearby', 'unchecked', 'problem']).toContain(incidentLabelKind(state));
		}
	});
});

describe('directory state -> public label', () => {
	it('is a separate ladder where Corroborating IS the community tier', () => {
		expect(directoryLabelKind('Corroborating')).toBe('nearby');
		// Same word, different machine: the incident ladder must not follow it.
		expect(incidentLabelKind('Corroborating')).toBe('unchecked');
	});

	it('treats Signed and Verified as team-checked', () => {
		expect(directoryLabelKind('Signed')).toBe('team');
		expect(directoryLabelKind('Verified')).toBe('team');
	});

	it('does not present a stale entry as still checked', () => {
		expect(STRONGER_THAN_UNCHECKED).not.toContain(directoryLabelKind('Stale'));
	});

	it('maps every canonical state to one of the four labels', () => {
		for (const state of DIRECTORY_STATES) {
			expect(['team', 'nearby', 'unchecked', 'problem']).toContain(directoryLabelKind(state));
		}
	});
});
