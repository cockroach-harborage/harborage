import { describe, expect, it } from 'vitest';
import { FLIPPABLE, LOCKED, isFlippable, isLocked } from '../src/flag-policy.ts';

describe('flag policy', () => {
	it('irreversible gates are locked and never flippable', () => {
		for (const gate of [
			'accountability_naming',
			'evidence_unredaction',
			'precise_location_reveal',
			'permanent_delete'
		]) {
			expect(isLocked(gate)).toBe(true);
			expect(isFlippable(gate)).toBe(false);
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
