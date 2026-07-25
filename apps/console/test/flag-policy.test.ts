import { describe, expect, it } from 'vitest';
import { FLAG_NAMES } from '@harborage/worker-lib/flags';
import { FLIPPABLE, LOCKED, isFlippable, isLocked } from '../src/flag-policy.ts';

describe('flag policy', () => {
	it('classifies every known flag, with none left over', () => {
		// Adding a flag requires editing packages/worker-lib/src/flags.ts AND this
		// console's policy, and nothing used to connect the two: a flag added to
		// the union and forgotten here is simply unflippable, with no failure
		// anywhere to notice. This is that failure.
		for (const name of FLAG_NAMES) {
			expect(isFlippable(name) || isLocked(name), `${name} is classified`).toBe(true);
		}
		// And nothing is classified that is not a known flag, so a rename in one
		// file leaves a dangling entry in the other rather than passing quietly.
		const known = new Set<string>(FLAG_NAMES);
		for (const name of FLIPPABLE) {
			expect(known.has(name), `${name} is a known flag`).toBe(true);
		}
	});

	it('irreversible gates are locked and never flippable', () => {
		for (const gate of [
			'accountability_naming',
			'evidence_unredaction',
			'precise_location_reveal',
			'permanent_delete',
			'detainee_intake',
			'incommunicado_alert'
		]) {
			expect(isLocked(gate)).toBe(true);
			expect(isFlippable(gate)).toBe(false);
		}
	});

	/**
	 * A LOCKED gate has NO RUNTIME READ PATH, which is stronger than being off.
	 * With no FLAG_NAMES entry, flagEnabled(kv, 'accountability_naming') does not
	 * typecheck, so a route cannot be written to consult it and its first statement
	 * can only be an unconditional refusal. "Off" is a value someone flips.
	 *
	 * This is why the test above only requires FLIPPABLE to be a subset of
	 * FLAG_NAMES: LOCKED entries are deliberately NOT known flags.
	 */
	it('keeps every locked gate out of FLAG_NAMES', () => {
		const known = new Set<string>(FLAG_NAMES);
		for (const gate of LOCKED) {
			expect(known.has(gate), `${gate} must have no runtime read path`).toBe(false);
		}
	});

	it('locked and flippable sets are disjoint', () => {
		for (const name of LOCKED) expect(isFlippable(name)).toBe(false);
		for (const name of FLIPPABLE) expect(isLocked(name)).toBe(false);
	});

	it('unknown names are neither', () => {
		expect(isFlippable('made_up')).toBe(false);
		expect(isLocked('made_up')).toBe(false);
	});

	it('heightened_threat is a reversible one-flip composite', () => {
		expect(isFlippable('heightened_threat')).toBe(true);
	});
});
