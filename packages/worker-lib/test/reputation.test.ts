import { describe, expect, it } from 'vitest';
import {
	CLUSTER_CAP,
	INITIAL_SCALAR_MILLI,
	MAX_EPOCH_GAIN_MILLI,
	MAX_SCALAR_MILLI,
	R_GATE_MILLI,
	corroborationWeight,
	decay,
	dedupToken,
	meetsGate,
	settle,
	voteWeight
} from '../src/reputation.ts';

describe('a fresh account is near-powerless', () => {
	it('starts below the participation gate', () => {
		expect(INITIAL_SCALAR_MILLI).toBeLessThan(R_GATE_MILLI);
		expect(meetsGate(INITIAL_SCALAR_MILLI)).toBe(false);
	});

	// Zero, not "small". A sub-gate account must contribute NOTHING to an
	// autonomous decision, or a farm of fresh accounts adds up to something.
	it('contributes exactly zero weight, not merely a little', () => {
		expect(voteWeight(INITIAL_SCALAR_MILLI)).toBe(0);
		expect(voteWeight(R_GATE_MILLI - 1)).toBe(0);
		expect(voteWeight(R_GATE_MILLI)).toBeGreaterThan(0);
	});

	it('a thousand fresh accounts still weigh nothing', () => {
		const farm = Array.from({ length: 1000 }, () => INITIAL_SCALAR_MILLI);
		expect(corroborationWeight([farm])).toBe(0);
	});
});

describe('√-damping stops a whale dominating', () => {
	it('gives sharply diminishing returns', () => {
		const low = voteWeight(250);
		const high = voteWeight(1000);
		// 4x the reputation buys 2x the weight, not 4x.
		expect(high / low).toBeCloseTo(2, 1);
	});

	it('caps the scalar so no account becomes structurally decisive', () => {
		expect(voteWeight(MAX_SCALAR_MILLI)).toBe(voteWeight(MAX_SCALAR_MILLI * 10));
	});
});

describe('cluster caps make Sybil clusters expensive', () => {
	// Ten accounts inside one behavioural cluster contribute what one does. The
	// attacker needs genuinely distinct clusters.
	it('collapses a cluster to the cap however many accounts are in it', () => {
		const many = Array.from({ length: 10 }, () => MAX_SCALAR_MILLI);
		expect(corroborationWeight([many])).toBe(CLUSTER_CAP);
	});

	it('rewards distinct clusters, not raw numbers', () => {
		const one = corroborationWeight([[MAX_SCALAR_MILLI, MAX_SCALAR_MILLI, MAX_SCALAR_MILLI]]);
		const three = corroborationWeight([
			[MAX_SCALAR_MILLI],
			[MAX_SCALAR_MILLI],
			[MAX_SCALAR_MILLI]
		]);
		expect(one).toBe(CLUSTER_CAP);
		expect(three).toBe(3 * CLUSTER_CAP);
	});

	it('ignores sub-gate members inside an otherwise real cluster', () => {
		const padded = corroborationWeight([[400, 50, 50, 50, 50]]);
		const alone = corroborationWeight([[400]]);
		expect(padded).toBe(alone);
	});
});

describe('decay and settlement make farming slow', () => {
	it('halves over the half-life', () => {
		expect(decay(1000, 60)).toBe(500);
		expect(decay(1000, 120)).toBe(250);
		expect(decay(1000, 0)).toBe(1000);
		expect(decay(1000, -5)).toBe(1000);
	});

	it('caps how much can be gained in one epoch', () => {
		let scalar = 100;
		let gained = 0;
		for (let i = 0; i < 10; i++) {
			const r = settle(scalar, 50, gained);
			scalar = r.scalarMilli;
			gained = r.gainedThisEpochMilli;
		}
		expect(gained).toBe(MAX_EPOCH_GAIN_MILLI);
		expect(scalar).toBe(100 + MAX_EPOCH_GAIN_MILLI);
	});

	// Deliberate asymmetry: being wrong costs faster than being right earns.
	// A flag storm has to be expensive, or it is free.
	it('applies losses without the epoch cap', () => {
		const r = settle(500, -400, MAX_EPOCH_GAIN_MILLI);
		expect(r.scalarMilli).toBe(100);
	});

	it('never goes below zero or above the ceiling', () => {
		expect(settle(10, -999, 0).scalarMilli).toBe(0);
		expect(settle(MAX_SCALAR_MILLI, 999, 0).scalarMilli).toBe(MAX_SCALAR_MILLI);
	});
});

describe('dedup tokens', () => {
	const salt = new Uint8Array(32).fill(1);
	const keyHash = new Uint8Array(32).fill(2);

	it('are stable for the same salt and key', async () => {
		expect(await dedupToken(salt, keyHash)).toBe(await dedupToken(salt, keyHash));
	});

	// The salt being per-item is what stops a token linking one participant
	// across items. Destroying it when the window closes is what makes the
	// membership oracle expire.
	it('differ across items even for the same participant', async () => {
		const other = new Uint8Array(32).fill(9);
		expect(await dedupToken(salt, keyHash)).not.toBe(await dedupToken(other, keyHash));
	});

	it('differ across participants within one item', async () => {
		const otherKey = new Uint8Array(32).fill(3);
		expect(await dedupToken(salt, keyHash)).not.toBe(await dedupToken(salt, otherKey));
	});

	it('reveal nothing of the key by length or shape', async () => {
		const token = await dedupToken(salt, keyHash);
		expect(token).toMatch(/^[0-9a-f]{32}$/);
	});
});
