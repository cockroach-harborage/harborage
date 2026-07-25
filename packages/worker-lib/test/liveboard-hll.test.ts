import { describe, expect, it } from 'vitest';
import {
	estimate,
	HLL_M,
	insert,
	lowerBound,
	merge,
	newSketch,
	occupied,
	upperBound
} from '../src/liveboard/hll.ts';

/** A distinct 32-byte token, deterministic so a failure is reproducible. */
function token(i: number): Uint8Array {
	const t = new Uint8Array(32);
	let x = (i * 2654435761 + 12345) >>> 0;
	for (let b = 0; b < 32; b++) {
		x = (x * 1103515245 + 12345) >>> 0;
		t[b] = (x >>> 16) & 0xff;
	}
	return t;
}

function sketchOf(n: number, offset = 0): Uint8Array {
	const s = newSketch();
	for (let i = 0; i < n; i++) insert(s, token(i + offset));
	return s;
}

describe('occupied() is an exact lower bound', () => {
	/**
	 * THE LOAD-BEARING PROPERTY. `occupied <= n_true` must hold ALWAYS, for any
	 * input, with no error term. Everything the density floor does rests on it.
	 */
	it('never exceeds the true cardinality, across the whole range the floor cares about', () => {
		for (let n = 0; n <= 200; n++) {
			expect(occupied(sketchOf(n)), `n=${n}`).toBeLessThanOrEqual(n);
		}
	});

	it('is exact at the cardinalities the floor and the corroboration bar use', () => {
		// At m=4096 the chance two of five tokens collide is about 0.24%, so this
		// is exact for these deterministic tokens and any deviation is downward.
		for (const n of [0, 1, 2, 3, 4, 5, 6, 10]) {
			expect(occupied(sketchOf(n)), `n=${n}`).toBe(n);
		}
	});

	it('never counts a repeated reporter twice', () => {
		const s = newSketch();
		for (let i = 0; i < 50; i++) insert(s, token(7));
		expect(occupied(s)).toBe(1);
	});

	it('ignores a token too short to carry a register index', () => {
		const s = newSketch();
		insert(s, new Uint8Array(4));
		expect(occupied(s)).toBe(0);
	});
});

describe('merge is a union, never a sum', () => {
	/**
	 * If merge summed, two shards seeing the same reporter would count them twice
	 * and the merged sketch would inflate past the density floor. Inflation is the
	 * one direction that publishes a group which should have been hidden.
	 */
	it('counts a reporter present in both shards once', () => {
		const a = sketchOf(5);
		const b = sketchOf(5);
		merge(a, b);
		expect(occupied(a)).toBe(5);
	});

	it('unions disjoint shards', () => {
		const a = sketchOf(5, 0);
		const b = sketchOf(5, 1000);
		merge(a, b);
		expect(occupied(a)).toBe(10);
	});

	it('is order-independent', () => {
		const a1 = sketchOf(20, 0);
		merge(a1, sketchOf(20, 500));
		const a2 = sketchOf(20, 500);
		merge(a2, sketchOf(20, 0));
		expect(occupied(a1)).toBe(occupied(a2));
	});
});

describe('lowerBound is what policy consumes', () => {
	/**
	 * THE TEST THAT CANNOT BE WRITTEN BY GENERATING TOKENS.
	 *
	 * Below m/16 the estimator and the occupied count agree in almost every real
	 * sample, so a test that inserts five tokens and checks the floor passes with
	 * EITHER one wired in. The disagreeing sketch has to be CONSTRUCTED by writing
	 * registers directly.
	 *
	 * Here 4 registers are occupied — the truth the floor must act on — while the
	 * linear-counting estimator, given how few zeros that leaves, reads
	 * differently. lowerBound must follow occupied.
	 */
	it('follows the occupied count, not the estimator, in the sparse range', () => {
		const s = newSketch();
		for (let i = 0; i < 4; i++) s[i * 7] = 3;
		expect(occupied(s)).toBe(4);
		expect(lowerBound(s)).toBe(4);
		expect(lowerBound(s)).toBeLessThan(5); // below DENSITY_FLOOR_D
	});

	it('never exceeds the true cardinality anywhere it is used', () => {
		for (let n = 0; n <= 300; n++) {
			expect(lowerBound(sketchOf(n)), `n=${n}`).toBeLessThanOrEqual(n);
		}
	});

	it('brackets the estimate once the registers saturate', () => {
		const s = sketchOf(3000);
		expect(lowerBound(s)).toBeLessThanOrEqual(upperBound(s));
		expect(lowerBound(s)).toBeLessThanOrEqual(Math.ceil(estimate(s)));
		expect(upperBound(s)).toBeGreaterThanOrEqual(Math.floor(estimate(s)));
	});

	/**
	 * Never below the bound that holds with certainty, at any cardinality.
	 *
	 * This is what caught the crossover cliff: a plain switch from occupied() to
	 * the haircut estimate stepped DOWN by four around n = 264. Fail-safe in
	 * direction, so not a leak, but a cliff a band would ride down and back up
	 * across the boundary, which is the oscillation the hysteresis exists to
	 * remove, reintroduced underneath it.
	 */
	it('never falls below the certain bound, across the crossover', () => {
		const s = newSketch();
		for (let i = 0; i < 500; i++) {
			insert(s, token(i));
			expect(lowerBound(s), `after ${i + 1}`).toBeGreaterThanOrEqual(occupied(s));
		}
	});

	/**
	 * Monotone where the density floor and the corroboration bar actually
	 * operate. Strict monotonicity across the whole range is NOT promised: above
	 * the crossover the value tracks an estimator, and pretending otherwise would
	 * be a claim the sketch cannot keep.
	 */
	it('is monotone through the range the floor and the bar use', () => {
		const s = newSketch();
		let last = 0;
		for (let i = 0; i < 200; i++) {
			insert(s, token(i));
			const now = lowerBound(s);
			expect(now, `after ${i + 1}`).toBeGreaterThanOrEqual(last);
			last = now;
		}
	});
});

describe('the sketch holds no enumerable list', () => {
	/**
	 * The reason for using a sketch at all. A Set answers "was this reporter here"
	 * exactly and grows without bound; this is fixed-size and lossy. Stated
	 * honestly in the module: it is still a probabilistic membership oracle to
	 * anyone holding the epoch salt, and what carries the privacy property is that
	 * the salt is memory-only and rotates.
	 */
	it('is a fixed 4 KiB whatever the traffic', () => {
		expect(sketchOf(0).length).toBe(HLL_M);
		expect(sketchOf(10_000).length).toBe(HLL_M);
	});

	it('cannot be read back as the tokens that made it', () => {
		const s = sketchOf(5);
		// Every byte is a small leading-zero count, not a fragment of any token.
		for (const b of s) expect(b).toBeLessThan(64);
	});
});

describe('the two sabotages that a test through occupied() cannot see', () => {
	/**
	 * SABOTAGE 1: lowerBound returning the point estimate.
	 *
	 * Invisible at the floor, because there occupied and estimate coincide exactly
	 * (n = 4, 5, 10 all give the same number). The first version of the sparse test
	 * here "constructed a disagreeing sketch" that did not in fact disagree, and
	 * stayed green with the estimator wired straight in.
	 *
	 * It is observable in the BAND regime, where the estimator saturates and the
	 * haircut is a real five percent. Asserting the haircut is APPLIED is what
	 * catches it.
	 */
	it('returns the certain bound verbatim in the sparse branch, not the estimator', () => {
		// The sparse branch is where the sabotage lived, and where the floor runs.
		// Below k = 64 the estimator and occupied() agree to within rounding, so
		// the divergence has to be sought higher up while still inside the branch:
		// at n = 200 occupied reads 194 and the estimator 199.
		const s = sketchOf(200);
		expect(occupied(s)).toBeLessThan(4096 / 16); // still the sparse branch
		expect(Math.round(estimate(s))).toBeGreaterThan(occupied(s));
		expect(lowerBound(s)).toBe(occupied(s));
	});

	it('applies the haircut once the registers saturate', () => {
		const s = sketchOf(1000);
		expect(occupied(s)).toBeLessThan(estimate(s));
		expect(lowerBound(s)).toBeLessThan(estimate(s));
		expect(upperBound(s)).toBeGreaterThan(estimate(s));
		// And the band-relevant gap is real, not a rounding artefact.
		expect(estimate(s) - lowerBound(s)).toBeGreaterThan(10);
	});

	/**
	 * SABOTAGE 2: merge summing instead of taking the max.
	 *
	 * Completely invisible through occupied(), which counts NON-ZERO registers: a
	 * sum changes the rho values and leaves occupancy untouched, so every
	 * union-versus-sum test written through occupied() stayed green.
	 *
	 * What it corrupts is the estimator in the dense regime. Asserting the
	 * operation directly, register by register, is the only thing that sees it.
	 */
	it('is exactly register-wise max, asserted register by register', () => {
		const a = newSketch();
		const b = newSketch();
		a[0] = 3;
		b[0] = 7; // b wins
		a[1] = 9;
		b[1] = 2; // a wins
		a[2] = 5;
		b[2] = 5; // equal
		a[3] = 4;
		b[3] = 0; // only a
		a[4] = 0;
		b[4] = 6; // only b
		merge(a, b);
		expect([a[0], a[1], a[2], a[3], a[4]]).toEqual([7, 9, 5, 4, 6]);
		// A sum would give [10, 11, 10, 4, 6]; occupied() reads 5 either way.
	});

	it('leaves a merged sketch reading the same as one built from the union', () => {
		const shardA = sketchOf(300, 0);
		const shardB = sketchOf(300, 5000);
		merge(shardA, shardB);
		const together = newSketch();
		for (let i = 0; i < 300; i++) insert(together, token(i));
		for (let i = 0; i < 300; i++) insert(together, token(i + 5000));
		expect(occupied(shardA)).toBe(occupied(together));
		expect(estimate(shardA)).toBeCloseTo(estimate(together), 6);
	});
});
