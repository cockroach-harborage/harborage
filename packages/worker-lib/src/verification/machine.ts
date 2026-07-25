/**
 * The verification state machine (ARCHITECTURE §15, §18.1).
 *
 * A PURE module: no imports, no clock, no storage, no I/O. Everything it needs
 * arrives as arguments and everything it decides comes back as a value. That is
 * what lets bare vitest drive every transition in the §15 table, and what lets
 * the conformance test prove the properties below rather than assert them in a
 * comment.
 *
 * THE ORGANIZING RULE, from which everything here follows:
 *
 *   AI and community may act autonomously ONLY on reversible, non-catastrophic
 *   actions. Every irreversible, high-harm action is m-of-n human-gated and
 *   ships OFF.
 *
 * So the action vocabulary is a closed enum of five reversible verbs. There is
 * no publish verb, no delete verb, no unredact verb, no name verb — not
 * disabled, not flag-gated, ABSENT. A model output cannot reach one because
 * none exists to reach.
 *
 * The second rule, equally load-bearing: the autonomous ceiling is held
 * deliberately low, below any label or reach a reader would treat as
 * reliable-for-action. A resourced state CAN climb the source-diversity wall
 * (§15 says so plainly). Credibility here rests on honest labelling, a low
 * ceiling and reversibility — never on the wall being unclimbable.
 */

// --- Actions ----------------------------------------------------------------

/**
 * The complete action vocabulary. Adding a verb to this list is a red-line
 * change: the conformance test fails on anything outside the reversible set,
 * and CODEOWNERS covers this path.
 */
export const ACTIONS = [
	'label',
	'rank',
	'hide-pending',
	'retain-pending',
	'route-to-gate'
] as const;
export type Action = (typeof ACTIONS)[number];

// --- States -----------------------------------------------------------------

export const STATES = [
	'Unverified',
	'AI-Screened',
	'Corroborating',
	'Community-Corroborated',
	'Human-Verified',
	'Disputed',
	'Debunked',
	'Quarantine-Pending'
] as const;
export type State = (typeof STATES)[number];

/** Only a human reviewer confers this. No autonomous path leads here, ever. */
export const LAYER_B_ONLY: readonly State[] = ['Human-Verified'];

/**
 * The highest state the autonomous layer may reach once the M3 corroboration
 * machinery is switched on.
 */
export const AUTONOMOUS_CEILING: State = 'Community-Corroborated';

/**
 * The highest state it may reach at M2. The reach machinery (√-damped
 * reputation, CIB, cohort-pivot) is M3 per §18.1, and without it there is no
 * honest way to evaluate the independence bar, so nothing climbs past screening.
 */
export const AUTONOMOUS_CEILING_M2: State = 'AI-Screened';

// --- Reach ------------------------------------------------------------------

/** Baseline is plain chronological placement. Amplified means > 1.0. */
export const BASELINE_REACH_MILLI = 1000;

/** The canonical §15 reach table, in thousandths to stay integer on the wire. */
export const REACH_MILLI: Record<State, number> = {
	'Quarantine-Pending': 0,
	Unverified: 1000,
	'AI-Screened': 1000,
	Corroborating: 1300,
	'Community-Corroborated': 1500,
	Disputed: 1000,
	Debunked: 300,
	'Human-Verified': 3000
};

export interface ReachInput {
	state: State;
	/**
	 * Real-time directives, logistics and calls to action. §15 carves these out
	 * as their own class: highest-harm disinfo, fastest-travelling, and
	 * llama-guard gives zero resistance because a false directive violates no
	 * hazard category.
	 */
	isDirective: boolean;
	/**
	 * True when the counter-signal itself clears the same independence bar as
	 * verification. False means the dispute is CIB-attributed or fails
	 * independence, i.e. synthesized.
	 */
	disputeIsIndependent?: boolean;
	/** Reach the item had earned before the dispute arrived. */
	earnedReachMilli?: number;
}

/**
 * Reach for a state, applying the two §15 rules that are easy to get wrong.
 *
 * 1. Directive content is NEVER amplified above baseline, whatever its state.
 *    It can carry `Community-Corroborated`'s label but not its boost, because a
 *    minutes-old burst driving a crowd is the failure that gets people hurt.
 *
 * 2. A dispute only clamps reach if the counter-signal clears the same
 *    independence bar as verification. Synthesized disagreement carries a
 *    contested LABEL and NO reach penalty — otherwise "muddy the waters"
 *    becomes a cheap suppression lever, and burying the truth is as much an
 *    attack as promoting a lie.
 */
export function reachMilli(input: ReachInput): number {
	if (input.state === 'Disputed') {
		const earned = input.earnedReachMilli ?? BASELINE_REACH_MILLI;
		// Independence-passing disagreement: clamp to baseline at most.
		if (input.disputeIsIndependent === true) {
			const clamped = Math.min(earned, BASELINE_REACH_MILLI);
			return input.isDirective ? Math.min(clamped, BASELINE_REACH_MILLI) : clamped;
		}
		// Synthesized: keep earned reach, gain only the label.
		return input.isDirective ? Math.min(earned, BASELINE_REACH_MILLI) : earned;
	}
	const base = REACH_MILLI[input.state];
	return input.isDirective ? Math.min(base, BASELINE_REACH_MILLI) : base;
}

// --- Inputs -----------------------------------------------------------------

/**
 * Everything the machine is allowed to know. Each pipeline stage emits a
 * normalized observation, never a verdict and never a deletion (§15); this is
 * the aggregate of those observations at decision time.
 */
export interface Observations {
	/** Tier-0 lexical floor found nothing. Free, always-on. */
	tier0Clean: boolean;
	/** A second, INDEPENDENT high-risk indication (pHash, classifier, report). */
	secondIndependentRisk: boolean;
	/** Classifier verdict; 'unavailable' when the spend cap has degraded us. */
	aiVerdict: 'safe' | 'unsafe' | 'unavailable';
	/** Classifier confidence in thousandths. */
	aiConfidenceMilli: number;
	/** Corroborators that cleared the independence test. */
	independentCorroborators: number;
	/** Distinct independence buckets those corroborators fell into. */
	independenceBuckets: number;
	/** Σ √r over corroborators above r_gate, cluster-capped. */
	corroborationWeight: number;
	/** Weight of flags against the item. */
	flagWeight: number;
	/** How long the item has existed, in ms. */
	dwellMs: number;
	/** An open coordinated-behaviour window touches this item. */
	cibOpen: boolean;
	/** A corroborating item chains to a prior high-rep source in another compartment. */
	crossCompartmentAnchor: boolean;
	/** The cohort-pivot detector fired (long unrelated histories suddenly agreeing). */
	cohortPivot: boolean;
	/** Directive / operational / call-to-action content. */
	isDirective: boolean;
	/** Exact pHash match to known-debunked, or provable provenance contradiction. */
	hardEvidenceDebunk: boolean;
	/** A counter-cluster exists at all. */
	counterClusterPresent: boolean;
	/** That counter-cluster clears the independence bar. */
	counterClusterIndependent: boolean;
}

export interface Policy {
	/** Promotion thresholds (§15, KV-tunable; heightened mode multiplies). */
	corroboratorsForCorroborating: number;
	weightForCorroborating: number;
	minDwellMsCorroborating: number;
	corroboratorsForCommunity: number;
	bucketsForCommunity: number;
	weightForCommunity: number;
	corroborationToFlagRatio: number;
	minDwellMsCommunity: number;
	/** llama-guard hold threshold in thousandths. */
	riskHoldMilli: number;
	/**
	 * The M3 corroboration-reach machinery. OFF at M2, which pins the ceiling at
	 * AI-Screened. Never silently waived to make a demo work: the low ceiling is
	 * the safety property, not an inconvenience.
	 */
	reachMachineryEnabled: boolean;
}

export const DEFAULT_POLICY: Policy = {
	corroboratorsForCorroborating: 2,
	weightForCorroborating: 3.0,
	minDwellMsCorroborating: 15 * 60_000,
	corroboratorsForCommunity: 4,
	bucketsForCommunity: 3,
	weightForCommunity: 6.0,
	corroborationToFlagRatio: 3,
	minDwellMsCommunity: 60 * 60_000,
	riskHoldMilli: 850,
	reachMachineryEnabled: false
};

/** Heightened-threat mode TIGHTENS ONLY. It can never loosen a threshold. */
export function heightened(policy: Policy): Policy {
	return {
		...policy,
		corroboratorsForCommunity: Math.max(policy.corroboratorsForCommunity, 6),
		bucketsForCommunity: Math.max(policy.bucketsForCommunity, 4),
		minDwellMsCommunity: Math.max(policy.minDwellMsCommunity, 180 * 60_000),
		corroborationToFlagRatio: Math.max(policy.corroborationToFlagRatio, 5),
		riskHoldMilli: Math.min(policy.riskHoldMilli, 800)
	};
}

// --- Transition -------------------------------------------------------------

export interface Decision {
	state: State;
	reachMilli: number;
	actions: Action[];
	/** Stable codes for the audit row. Never content, never an identifier. */
	reasons: string[];
}

/**
 * Compute the next state from the current one and the observations.
 *
 * Fail-safe direction is fixed in every branch (§15 "Fail-safe defaults"):
 * uncertainty holds rather than destroys, disagreement labels rather than
 * suppresses, and nothing good is lost while humans are absent.
 */
export function nextState(
	current: State,
	obs: Observations,
	policy: Policy = DEFAULT_POLICY
): Decision {
	const reasons: string[] = [];
	const actions = new Set<Action>(['label']);

	// A human verdict is never overwritten by the autonomous layer. Only Layer B
	// moves an item out of Human-Verified.
	if (current === 'Human-Verified') {
		return decide(current, obs, [...actions], ['human_verified_held']);
	}

	// --- Quarantine (hide, never delete) ------------------------------------
	//
	// Two INDEPENDENT high-risk indications are required. Tier-0 lexical alone
	// is not enough and must never be: two regexes over one text are one signal
	// wearing two hats, and the lexicon is public, so a single-signal rule would
	// be both trivially evadable and trivially weaponisable against an innocent
	// post that happens to quote a slur it is reporting.
	const highRisk =
		obs.aiVerdict === 'unsafe' && obs.aiConfidenceMilli >= policy.riskHoldMilli;
	if (highRisk && obs.secondIndependentRisk) {
		actions.add('hide-pending');
		actions.add('retain-pending');
		actions.add('route-to-gate');
		reasons.push('two_independent_risk');
		return decide('Quarantine-Pending', obs, [...actions], reasons);
	}
	if (highRisk && !obs.secondIndependentRisk) {
		// Single signal: hold and queue, do not hide. Uncertain is not guilty.
		actions.add('retain-pending');
		actions.add('route-to-gate');
		reasons.push('single_risk_held');
		return decide('Disputed', obs, [...actions], reasons);
	}

	// --- Debunk (hard evidence only) ----------------------------------------
	if (obs.hardEvidenceDebunk) {
		actions.add('rank');
		actions.add('retain-pending');
		reasons.push('hard_evidence');
		return decide('Debunked', obs, [...actions], reasons);
	}

	// --- Coordinated flags are an attack signal, not consensus ---------------
	//
	// A flag storm must never bury the truth. Coordinated flagging routes to
	// Disputed plus the human queue; it never auto-suppresses, and under the
	// reach rule a synthesized dispute carries no reach penalty at all.
	if (obs.cibOpen && obs.counterClusterPresent) {
		actions.add('retain-pending');
		actions.add('route-to-gate');
		reasons.push('coordinated_counter_cluster');
		return decide('Disputed', obs, [...actions], reasons, { disputeIsIndependent: false });
	}

	// --- Genuine, independence-passing disagreement --------------------------
	if (obs.counterClusterPresent && obs.counterClusterIndependent) {
		actions.add('rank');
		actions.add('route-to-gate');
		reasons.push('independent_counter_cluster');
		return decide('Disputed', obs, [...actions], reasons, { disputeIsIndependent: true });
	}

	// --- Screening ------------------------------------------------------------
	if (!obs.tier0Clean) {
		// Lexically flagged but not two-signal high risk: stay put, queue it.
		actions.add('route-to-gate');
		reasons.push('tier0_flagged');
		return decide(current === 'Unverified' ? 'Unverified' : current, obs, [...actions], reasons);
	}

	let next: State = current;
	if (obs.aiVerdict === 'safe' && obs.tier0Clean && rank(current) < rank('AI-Screened')) {
		next = 'AI-Screened';
		reasons.push('screened_clean');
	}

	// --- Promotion beyond screening is M3 machinery --------------------------
	//
	// Held OFF at M2. §15's degraded-mode rule also lives here: when AI is
	// unavailable, community-only items may still reach Corroborating, but
	// Community-Corroborated is HELD because its AI-concurrence precondition is
	// unmet. AI concurrence is never silently waived to unblock a promotion.
	if (!policy.reachMachineryEnabled) {
		reasons.push('reach_machinery_off');
		return decide(cap(next, AUTONOMOUS_CEILING_M2), obs, [...actions], reasons);
	}

	const corroborating =
		obs.independentCorroborators >= policy.corroboratorsForCorroborating &&
		obs.corroborationWeight >= policy.weightForCorroborating &&
		obs.dwellMs >= policy.minDwellMsCorroborating &&
		!obs.cibOpen;

	if (corroborating && rank(next) < rank('Corroborating')) {
		next = 'Corroborating';
		actions.add('rank');
		reasons.push('corroborating');
	}

	const community =
		corroborating &&
		obs.independentCorroborators >= policy.corroboratorsForCommunity &&
		obs.independenceBuckets >= policy.bucketsForCommunity &&
		obs.corroborationWeight >= policy.weightForCommunity &&
		obs.corroborationWeight >= obs.flagWeight * policy.corroborationToFlagRatio &&
		obs.dwellMs >= policy.minDwellMsCommunity &&
		obs.crossCompartmentAnchor &&
		obs.aiVerdict === 'safe' &&
		!obs.cibOpen &&
		!obs.cohortPivot;

	if (community && rank(next) < rank('Community-Corroborated')) {
		// Directive content can reach this LABEL but never this reach; reachMilli
		// enforces that independently, so both paths agree.
		next = 'Community-Corroborated';
		actions.add('rank');
		reasons.push('community_corroborated');
	} else if (corroborating && obs.aiVerdict === 'unavailable') {
		reasons.push('ai_concurrence_unavailable_hold');
	}

	return decide(cap(next, AUTONOMOUS_CEILING), obs, [...actions], reasons);
}

function decide(
	state: State,
	obs: Observations,
	actions: Action[],
	reasons: string[],
	over: { disputeIsIndependent?: boolean } = {}
): Decision {
	return {
		state,
		reachMilli: reachMilli({
			state,
			isDirective: obs.isDirective,
			...(over.disputeIsIndependent === undefined
				? {}
				: { disputeIsIndependent: over.disputeIsIndependent })
		}),
		actions,
		reasons
	};
}

/** Promotion order. Side states are not on the ladder and rank below the floor. */
function rank(state: State): number {
	switch (state) {
		case 'Unverified':
			return 1;
		case 'AI-Screened':
			return 2;
		case 'Corroborating':
			return 3;
		case 'Community-Corroborated':
			return 4;
		case 'Human-Verified':
			return 5;
		default:
			return 0;
	}
}

/** Never let an autonomous decision exceed the ceiling, whatever the inputs. */
function cap(state: State, ceiling: State): State {
	return rank(state) > rank(ceiling) ? ceiling : state;
}
