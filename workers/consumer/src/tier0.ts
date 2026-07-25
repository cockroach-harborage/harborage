/**
 * Tier-0 lexical floor (ARCHITECTURE §15). Free, always-on, runs on 100% of
 * items before any paid call.
 *
 * What it is: a cheap first look that produces normalized OBSERVATIONS. It
 * never produces a verdict and never removes anything. Its output feeds the
 * state machine, which is the only thing that mutates authority.
 *
 * Why the lexicon is not in this repository: a published incitement lexicon is
 * a bypass cheat-sheet — anyone can read exactly which strings to avoid — and
 * a repository copy would also trip gate-ai-tells on its own vocabulary. It
 * lives in the RULESETS KV namespace, loaded at runtime.
 *
 * THE CRITICAL LIMIT, encoded rather than commented: a Tier-0 hit is ONE
 * signal, even when several patterns match. Several regexes over one text are
 * one signal wearing several hats. The machine requires two INDEPENDENT signals
 * before it will hide anything, and this module can never supply the second
 * one by matching harder.
 */

export interface Ruleset {
	/** Incitement/violence-intent patterns, en + hi. */
	incitement?: string[];
	/** Private-individual identifier patterns (doxx tripwire). */
	privatePii?: string[];
	/** Directive / operational / call-to-action patterns. */
	directive?: string[];
	/** Perceptual hashes of known-debunked media. */
	knownBadPhash?: string[];
}

export interface Tier0Result {
	/** Nothing matched. */
	clean: boolean;
	/** Which categories matched. Category codes only, never the matched text. */
	categories: string[];
	/** Directive/operational content, which is never autonomously amplified. */
	isDirective: boolean;
	/** Exact match against known-debunked media. */
	knownBadMedia: boolean;
}

/**
 * A ruleset that matches nothing. Used when KV is empty or unreadable.
 *
 * Fail-OPEN is correct here and fail-closed would be wrong, which is worth
 * being explicit about because it inverts the usual rule. A missing lexicon
 * must not mean "treat everything as incitement" — that would let a KV blip
 * quarantine every report during exactly the surge when reporting matters. The
 * safe direction for a SCREEN is to observe nothing and let the item sit at
 * Unverified, which is unamplified anyway. Nothing is promoted on Tier-0's say
 * so; it can only ever add suspicion.
 */
export const EMPTY_RULESET: Ruleset = {};

/** Compile once per batch; a per-item compile is the whole cost of this stage. */
export interface CompiledRuleset {
	incitement: RegExp[];
	privatePii: RegExp[];
	directive: RegExp[];
	knownBadPhash: Set<string>;
}

/**
 * Patterns come from KV, so a malformed one must not take the consumer down
 * and must not silently disable the rest of the list.
 */
function compile(patterns: string[] | undefined): RegExp[] {
	const out: RegExp[] = [];
	for (const p of patterns ?? []) {
		try {
			out.push(new RegExp(p, 'iu'));
		} catch {
			// Skip the bad pattern, keep the good ones.
		}
	}
	return out;
}

export function compileRuleset(ruleset: Ruleset): CompiledRuleset {
	return {
		incitement: compile(ruleset.incitement),
		privatePii: compile(ruleset.privatePii),
		directive: compile(ruleset.directive),
		knownBadPhash: new Set(ruleset.knownBadPhash ?? [])
	};
}

export function screen(
	text: string,
	rules: CompiledRuleset,
	phash?: string | undefined
): Tier0Result {
	const categories: string[] = [];
	if (rules.incitement.some((re) => re.test(text))) categories.push('incitement');
	if (rules.privatePii.some((re) => re.test(text))) categories.push('private_pii');

	// Ambiguity resolves TOWARD the directive class, which is the more
	// restrictive one: directives are never amplified above baseline. Getting
	// this backwards would let a false "police are clearing, disperse now" ride
	// the corroboration boost into a crowd.
	const isDirective = rules.directive.some((re) => re.test(text));
	const knownBadMedia = phash !== undefined && rules.knownBadPhash.has(phash);
	if (knownBadMedia) categories.push('known_bad_media');

	return {
		clean: categories.length === 0,
		categories,
		isDirective,
		knownBadMedia
	};
}

/**
 * Load the ruleset from KV. Any failure yields the empty ruleset: see
 * EMPTY_RULESET for why fail-open is the safe direction for a screen.
 */
export async function loadRuleset(kv: {
	get(key: string, options?: { type?: 'json'; cacheTtl?: number }): Promise<unknown>;
}): Promise<Ruleset> {
	try {
		const raw = (await kv.get('tier0:v1', { type: 'json', cacheTtl: 300 })) as Ruleset | null;
		return raw && typeof raw === 'object' ? raw : EMPTY_RULESET;
	} catch {
		return EMPTY_RULESET;
	}
}
