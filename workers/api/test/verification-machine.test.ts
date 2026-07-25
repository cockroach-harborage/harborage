/**
 * Conformance tests for the §15 machine, including the §18.5-P2 requirement
 * that no path leads from a model or community output to publish, delete,
 * unredact or name.
 *
 * These are not characterisation tests. Each one encodes a property the
 * charter states, so a change that breaks the property fails here rather than
 * being noticed by a reader of a diff.
 */
import { describe, expect, it } from 'vitest';
import {
	ACTIONS,
	AUTONOMOUS_CEILING,
	AUTONOMOUS_CEILING_M2,
	BASELINE_REACH_MILLI,
	DEFAULT_POLICY,
	LAYER_B_ONLY,
	REACH_MILLI,
	STATES,
	heightened,
	nextState,
	reachMilli,
	type Observations,
	type Policy,
	type State
} from '../src/verification/machine.ts';

const CLEAN: Observations = {
	tier0Clean: true,
	secondIndependentRisk: false,
	aiVerdict: 'safe',
	aiConfidenceMilli: 100,
	independentCorroborators: 0,
	independenceBuckets: 0,
	corroborationWeight: 0,
	flagWeight: 0,
	dwellMs: 0,
	cibOpen: false,
	crossCompartmentAnchor: false,
	cohortPivot: false,
	isDirective: false,
	hardEvidenceDebunk: false,
	counterClusterPresent: false,
	counterClusterIndependent: false
};

const obs = (over: Partial<Observations> = {}): Observations => ({ ...CLEAN, ...over });
const M3: Policy = { ...DEFAULT_POLICY, reachMachineryEnabled: true };

/** Everything needed to clear the Community-Corroborated bar. */
const FULLY_CORROBORATED = obs({
	independentCorroborators: 4,
	independenceBuckets: 3,
	corroborationWeight: 6,
	flagWeight: 0,
	dwellMs: 61 * 60_000,
	crossCompartmentAnchor: true
});

describe('the action vocabulary is closed and reversible', () => {
	it('contains exactly the five reversible verbs', () => {
		expect([...ACTIONS]).toEqual([
			'label',
			'rank',
			'hide-pending',
			'retain-pending',
			'route-to-gate'
		]);
	});

	// The §18.5-P2 source-level guard lives in tools/gates/gate-action-vocabulary.mjs
	// rather than here: as a gate it runs on every build, not only when tests
	// run, and workers/api has no node types to read a file with anyway.

	it('never emits an action outside the enum, across a wide input sweep', () => {
		const allowed = new Set<string>(ACTIONS);
		for (const state of STATES) {
			for (const flags of sweep()) {
				for (const policy of [DEFAULT_POLICY, M3, heightened(M3)]) {
					for (const action of nextState(state, flags, policy).actions) {
						expect(allowed.has(action)).toBe(true);
					}
				}
			}
		}
	});
});

describe('the autonomous ceiling holds', () => {
	it('is AI-Screened at M2, whatever the corroboration says', () => {
		const decision = nextState('Unverified', FULLY_CORROBORATED, DEFAULT_POLICY);
		expect(decision.state).toBe(AUTONOMOUS_CEILING_M2);
		expect(decision.reasons).toContain('reach_machinery_off');
	});

	it('never reaches Human-Verified from any input, at any policy', () => {
		for (const state of STATES) {
			for (const flags of sweep()) {
				for (const policy of [DEFAULT_POLICY, M3, heightened(M3)]) {
					const next = nextState(state, flags, policy);
					if (state !== 'Human-Verified') {
						expect(LAYER_B_ONLY).not.toContain(next.state);
					}
				}
			}
		}
	});

	it('never exceeds Community-Corroborated even with the M3 machinery on', () => {
		const generous: Policy = {
			...M3,
			corroboratorsForCommunity: 0,
			bucketsForCommunity: 0,
			weightForCommunity: 0,
			minDwellMsCommunity: 0,
			corroboratorsForCorroborating: 0,
			weightForCorroborating: 0,
			minDwellMsCorroborating: 0
		};
		const next = nextState('Unverified', FULLY_CORROBORATED, generous);
		expect(next.state).toBe(AUTONOMOUS_CEILING);
	});

	it('leaves a human verdict alone', () => {
		const next = nextState('Human-Verified', obs({ counterClusterPresent: true }), M3);
		expect(next.state).toBe('Human-Verified');
	});
});

describe('quarantine hides and retains, and needs two independent signals', () => {
	// The lexicon is public, so a single-signal rule is both trivially evadable
	// and trivially weaponisable against a post quoting a slur it is reporting.
	it('does not hide on a lexical hit alone', () => {
		const next = nextState('Unverified', obs({ tier0Clean: false }), M3);
		expect(next.actions).not.toContain('hide-pending');
		expect(next.state).not.toBe('Quarantine-Pending');
	});

	it('does not hide on a single high-confidence classifier hit', () => {
		const next = nextState(
			'Unverified',
			obs({ aiVerdict: 'unsafe', aiConfidenceMilli: 990, secondIndependentRisk: false }),
			M3
		);
		expect(next.actions).not.toContain('hide-pending');
		expect(next.state).toBe('Disputed');
		expect(next.actions).toContain('route-to-gate');
	});

	it('hides only with two independent signals, and always retains', () => {
		const next = nextState(
			'Unverified',
			obs({ aiVerdict: 'unsafe', aiConfidenceMilli: 990, secondIndependentRisk: true }),
			M3
		);
		expect(next.state).toBe('Quarantine-Pending');
		expect(next.actions).toContain('hide-pending');
		// Hidden is not gone. Retained and queued, always.
		expect(next.actions).toContain('retain-pending');
		expect(next.actions).toContain('route-to-gate');
		expect(next.reachMilli).toBe(0);
	});
});

describe('a flag storm cannot bury the truth', () => {
	it('routes coordinated flagging to Disputed and the human queue, never to hidden', () => {
		const next = nextState(
			'Corroborating',
			obs({ cibOpen: true, counterClusterPresent: true, flagWeight: 50 }),
			M3
		);
		expect(next.state).toBe('Disputed');
		expect(next.actions).not.toContain('hide-pending');
		expect(next.actions).toContain('route-to-gate');
	});

	// The suppression lever this closes: if synthesized disagreement clamped
	// reach, an attacker could bury any item cheaply by manufacturing dissent.
	it('gives synthesized disagreement a label but no reach penalty', () => {
		const earned = 1500;
		const synthesized = reachMilli({
			state: 'Disputed',
			isDirective: false,
			disputeIsIndependent: false,
			earnedReachMilli: earned
		});
		expect(synthesized).toBe(earned);
	});

	it('lets genuine independence-passing disagreement clamp reach to baseline', () => {
		const clamped = reachMilli({
			state: 'Disputed',
			isDirective: false,
			disputeIsIndependent: true,
			earnedReachMilli: 1500
		});
		expect(clamped).toBe(BASELINE_REACH_MILLI);
	});
});

describe('directive content is never amplified', () => {
	it('stays at or below baseline in every state', () => {
		for (const state of STATES) {
			expect(reachMilli({ state, isDirective: true })).toBeLessThanOrEqual(BASELINE_REACH_MILLI);
		}
	});

	it('can carry the corroborated label without the boost', () => {
		const next = nextState('Corroborating', { ...FULLY_CORROBORATED, isDirective: true }, M3);
		expect(next.state).toBe('Community-Corroborated');
		expect(next.reachMilli).toBe(BASELINE_REACH_MILLI);
	});
});

describe('the reach table matches §15 exactly', () => {
	it('pins every value', () => {
		expect(REACH_MILLI).toEqual({
			'Quarantine-Pending': 0,
			Unverified: 1000,
			'AI-Screened': 1000,
			Corroborating: 1300,
			'Community-Corroborated': 1500,
			Disputed: 1000,
			Debunked: 300,
			'Human-Verified': 3000
		});
	});

	it('never amplifies Unverified or AI-Screened', () => {
		expect(reachMilli({ state: 'Unverified', isDirective: false })).toBe(BASELINE_REACH_MILLI);
		expect(reachMilli({ state: 'AI-Screened', isDirective: false })).toBe(BASELINE_REACH_MILLI);
	});
});

describe('degraded mode does not stall truth or hand out a free pass', () => {
	it('still allows Corroborating when the classifier is unavailable', () => {
		const next = nextState(
			'AI-Screened',
			{ ...FULLY_CORROBORATED, aiVerdict: 'unavailable' },
			M3
		);
		expect(next.state).toBe('Corroborating');
	});

	// AI concurrence is a precondition for the top autonomous state and is never
	// silently waived to unblock a promotion.
	it('holds Community-Corroborated when the classifier is unavailable', () => {
		const next = nextState(
			'AI-Screened',
			{ ...FULLY_CORROBORATED, aiVerdict: 'unavailable' },
			M3
		);
		expect(next.state).not.toBe('Community-Corroborated');
		expect(next.reasons).toContain('ai_concurrence_unavailable_hold');
	});
});

describe('heightened-threat mode tightens only', () => {
	it('never loosens a threshold', () => {
		const tightened = heightened(M3);
		expect(tightened.corroboratorsForCommunity).toBeGreaterThanOrEqual(
			M3.corroboratorsForCommunity
		);
		expect(tightened.bucketsForCommunity).toBeGreaterThanOrEqual(M3.bucketsForCommunity);
		expect(tightened.minDwellMsCommunity).toBeGreaterThanOrEqual(M3.minDwellMsCommunity);
		expect(tightened.corroborationToFlagRatio).toBeGreaterThanOrEqual(
			M3.corroborationToFlagRatio
		);
		// A LOWER hold threshold is tighter: it quarantines sooner.
		expect(tightened.riskHoldMilli).toBeLessThanOrEqual(M3.riskHoldMilli);
	});

	it('blocks a promotion that the normal policy would have allowed', () => {
		const normal = nextState('Corroborating', FULLY_CORROBORATED, M3);
		const strict = nextState('Corroborating', FULLY_CORROBORATED, heightened(M3));
		expect(normal.state).toBe('Community-Corroborated');
		expect(strict.state).not.toBe('Community-Corroborated');
	});
});

describe('promotion needs every condition, not most of them', () => {
	const drop: Array<[string, Partial<Observations>]> = [
		['too few corroborators', { independentCorroborators: 3 }],
		['too few independence buckets', { independenceBuckets: 2 }],
		['not enough weight', { corroborationWeight: 5 }],
		['dwell too short', { dwellMs: 59 * 60_000 }],
		['no cross-compartment anchor', { crossCompartmentAnchor: false }],
		['flags too close to corroboration', { flagWeight: 3 }],
		['an open coordination window', { cibOpen: true }],
		['the cohort-pivot detector fired', { cohortPivot: true }]
	];

	for (const [why, over] of drop) {
		it(`refuses Community-Corroborated with ${why}`, () => {
			const next = nextState('Corroborating', { ...FULLY_CORROBORATED, ...over }, M3);
			expect(next.state).not.toBe('Community-Corroborated');
		});
	}
});

describe('nothing good is destroyed while humans are absent', () => {
	it('always retains and queues whenever it acts adversely', () => {
		for (const flags of sweep()) {
			for (const policy of [DEFAULT_POLICY, M3]) {
				const next = nextState('AI-Screened', flags, policy);
				if (next.actions.includes('hide-pending')) {
					expect(next.actions).toContain('retain-pending');
					expect(next.actions).toContain('route-to-gate');
				}
			}
		}
	});

	it('debunks only on hard evidence, and retains even then', () => {
		const next = nextState('Community-Corroborated', obs({ hardEvidenceDebunk: true }), M3);
		expect(next.state).toBe('Debunked');
		expect(next.actions).toContain('retain-pending');
		// Reduced reach, not zero: the item stays readable with its correction.
		expect(next.reachMilli).toBeGreaterThan(0);
	});
});

/** A spread of observation combinations, enough to exercise every branch. */
function sweep(): Observations[] {
	const out: Observations[] = [];
	for (const tier0Clean of [true, false]) {
		for (const aiVerdict of ['safe', 'unsafe', 'unavailable'] as const) {
			for (const secondIndependentRisk of [true, false]) {
				for (const cibOpen of [true, false]) {
					for (const counterClusterPresent of [true, false]) {
						for (const isDirective of [true, false]) {
							out.push(
								obs({
									tier0Clean,
									aiVerdict,
									aiConfidenceMilli: 990,
									secondIndependentRisk,
									cibOpen,
									counterClusterPresent,
									counterClusterIndependent: !cibOpen,
									isDirective,
									independentCorroborators: 4,
									independenceBuckets: 3,
									corroborationWeight: 6,
									dwellMs: 61 * 60_000,
									crossCompartmentAnchor: true
								})
							);
						}
					}
				}
			}
		}
	}
	return out;
}
