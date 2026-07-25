import { describe, expect, it } from 'vitest';
import { EMPTY_RULESET, compileRuleset, loadRuleset, screen } from '../src/tier0.ts';

const RULES = compileRuleset({
	incitement: ['\\bburn it (all )?down\\b'],
	privatePii: ['\\b\\d{10}\\b'],
	directive: ['\\b(move|regroup|disperse) (south|north|now)\\b', 'पुलिस आ रही'],
	knownBadPhash: ['aabbccdd']
});

describe('tier-0 screening', () => {
	it('passes ordinary copy', () => {
		const r = screen('Police used gas near the north gate this afternoon.', RULES);
		expect(r.clean).toBe(true);
		expect(r.categories).toEqual([]);
		expect(r.isDirective).toBe(false);
	});

	it('reports a category, never the matched text', () => {
		const r = screen('we should burn it down tonight', RULES);
		expect(r.clean).toBe(false);
		expect(r.categories).toContain('incitement');
		// The observation carries a code. Echoing the match would put the content
		// into every downstream log and audit row.
		expect(JSON.stringify(r)).not.toContain('burn it down');
	});

	it('detects a private identifier', () => {
		expect(screen('call 9876543210', RULES).categories).toContain('private_pii');
	});

	it('classifies directive content, in both languages', () => {
		expect(screen('organizers say regroup north', RULES).isDirective).toBe(true);
		expect(screen('पुलिस आ रही है', RULES).isDirective).toBe(true);
	});

	// Directive is the more restrictive class: it is never amplified above
	// baseline. Getting this backwards would let a false "disperse now" ride a
	// corroboration boost into a crowd.
	it('treats directive content as directive even when otherwise clean', () => {
		const r = screen('move south now', RULES);
		expect(r.clean).toBe(true);
		expect(r.isDirective).toBe(true);
	});

	it('matches known-bad media only on an exact hash', () => {
		expect(screen('x', RULES, 'aabbccdd').knownBadMedia).toBe(true);
		expect(screen('x', RULES, 'aabbccde').knownBadMedia).toBe(false);
		expect(screen('x', RULES).knownBadMedia).toBe(false);
	});

	// Several patterns matching is still ONE signal. The machine needs two
	// INDEPENDENT signals before it hides anything, and this stage can never
	// supply the second by matching harder.
	it('is one signal however many patterns match', () => {
		const r = screen('burn it down, call 9876543210, disperse now', RULES);
		expect(r.categories.length).toBeGreaterThan(1);
		expect(Object.keys(r)).not.toContain('secondIndependentRisk');
	});
});

describe('a missing or broken ruleset fails open', () => {
	// Deliberately the opposite of the usual rule, and worth being explicit
	// about: a missing lexicon must not mean "treat everything as incitement",
	// which would quarantine every report during exactly the surge when
	// reporting matters. Nothing is ever promoted on Tier-0's say-so, so
	// observing nothing is safe; observing everything is not.
	it('matches nothing when the ruleset is empty', () => {
		const r = screen('burn it down', compileRuleset(EMPTY_RULESET));
		expect(r.clean).toBe(true);
		expect(r.isDirective).toBe(false);
	});

	it('returns the empty ruleset when KV throws or is empty', async () => {
		expect(
			await loadRuleset({
				get: async () => {
					throw new Error('kv down');
				}
			})
		).toEqual(EMPTY_RULESET);
		expect(await loadRuleset({ get: async () => null })).toEqual(EMPTY_RULESET);
		expect(await loadRuleset({ get: async () => 'not an object' })).toEqual(EMPTY_RULESET);
	});

	// A single malformed pattern from KV must not take the consumer down, nor
	// silently disable the rest of the list.
	it('skips a malformed pattern and keeps the rest', () => {
		const rules = compileRuleset({ incitement: ['(unclosed', '\\bbad\\b'] });
		expect(screen('this is bad', rules).categories).toContain('incitement');
		expect(screen('this is fine', rules).clean).toBe(true);
	});
});
