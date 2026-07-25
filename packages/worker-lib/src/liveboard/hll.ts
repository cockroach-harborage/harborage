/**
 * HyperLogLog over per-(zone, epoch) dedup tokens (ARCHITECTURE §6.2).
 *
 * WHY A SKETCH AT ALL, stated honestly, because "HyperLogLog is
 * privacy-preserving" is not the reason and repeating it would be an overclaim.
 *
 * It is NOT for memory. Two hundred reporters in a `Set` is nothing. It is
 * because a `Set<dedup_token>` IS the who-was-where structure red line 3
 * forbids, only in RAM: it answers "was this reporter in this zone" EXACTLY, and
 * it grows without bound, which is the silent out-of-memory kill §18.4 warns
 * about. The sketch removes the enumerable list and makes the membership test
 * probabilistic instead of exact.
 *
 * DO NOT OVERSTATE IT. Anyone holding the epoch salt and a candidate credential
 * can compute that token's register index and rho and test `register[i] >= rho`.
 * That is a probabilistic membership oracle worth roughly p + rho bits. What
 * actually carries the privacy property is that the salt is memory-only, never
 * logged, and rotates every fifteen minutes. The sketch's contribution is
 * narrower than the name suggests.
 *
 * THE FLOOR CONSUMES A LOWER BOUND, NEVER THE POINT ESTIMATE — and be precise
 * about where that actually bites, because the obvious framing is wrong.
 *
 * At the cardinalities the density floor cares about the two COINCIDE: measured,
 * n = 4, 5 and 10 give occupied = estimate = 4, 5, 10 exactly, because linear
 * counting overestimates by only about k^2/2m, which is 0.002 at k = 4. So a test
 * that inserts five tokens and checks the floor passes with either one wired in,
 * and the first version of that test here did.
 *
 * The choice is still right, for two reasons that are not "the estimator reads 6
 * when the truth is 4":
 *
 *   1. occupied() cannot exceed the truth in ANY regime, including ones the
 *      estimator has not been characterised in. It needs no assumption to hold.
 *   2. It bites for real in the BAND regime, where the estimator saturates: at
 *      n = 1000 occupied reads 869, the estimator 977, and the haircut 928. A
 *      crowd band rising on the estimator rises earlier than one rising on the
 *      bound, and earlier means a smaller real crowd is announced as larger.
 */

/** Register count exponent. 4096 registers, one byte each, so 4 KiB per sketch. */
export const HLL_P = 12;
export const HLL_M = 1 << HLL_P;

/**
 * Unpacked: one byte per 6-bit register.
 *
 * Packing to 3 KiB is available and premature. The saving is 25% of a 4 KiB
 * allocation, against arithmetic that has to be right the first time in a class
 * whose failure mode is publishing a group that should have been hidden.
 */
export type Sketch = Uint8Array;

export function newSketch(): Sketch {
	return new Uint8Array(HLL_M);
}

/**
 * Fold a 32-byte token into the sketch.
 *
 * The token is already an HMAC under the epoch salt, so it is uniformly
 * distributed and needs no further hashing: the first HLL_P bits pick the
 * register and the next bits give the leading-zero run.
 */
export function insert(s: Sketch, token: Uint8Array): void {
	if (token.length < 8) return;
	const idx = (((token[0] ?? 0) << 8) | (token[1] ?? 0)) & (HLL_M - 1);
	// rho is 1-indexed and never 0, so an occupied register always holds >= 1 and
	// 0 unambiguously means "untouched". That is what makes occupied() exact.
	let rho = 1;
	for (let byte = 2; byte < token.length && rho <= 64; byte++) {
		const b = token[byte] ?? 0;
		if (b !== 0) {
			for (let bit = 7; bit >= 0; bit--) {
				if ((b >> bit) & 1) break;
				rho++;
			}
			break;
		}
		rho += 8;
	}
	const at = s[idx] ?? 0;
	if (rho > at) s[idx] = Math.min(rho, 255);
}

/**
 * Register-wise max.
 *
 * NAMED BLOCKER FOR A FUTURE SHARD-OUT, so it is not rediscovered badly:
 * sharding ingest requires a SHARED per-(zone, epoch) salt. With per-shard salts
 * the same reporter produces a different token on each shard, the union counts
 * them separately, and the merged sketch inflates past the density floor — which
 * is the one direction that publishes a group that should have been hidden.
 */
export function merge(into: Sketch, from: Sketch): void {
	for (let i = 0; i < HLL_M; i++) {
		const a = into[i] ?? 0;
		const b = from[i] ?? 0;
		if (b > a) into[i] = b;
	}
}

/**
 * Occupied registers: an EXACT lower bound on the true cardinality.
 *
 * Not a Gaussian haircut and not a confidence interval. Every distinct token
 * sets exactly one register, an occupied register always holds rho >= 1, and
 * merge is register-wise max, so the merged occupied set is the union of the
 * shard occupied sets. Therefore `occupied <= n_true` ALWAYS, for any hash, any
 * input, any merge order. Distribution-free, confidence 1, no z term.
 *
 * For the cardinalities the floor cares about (D >= 5, K >= 3) that is the whole
 * answer: at m = 4096 the chance two of five tokens collide is about 0.24%, and
 * every deviation is DOWNWARD, so a collision withholds publication for one more
 * tick. Fail-safe by construction rather than by tuning.
 */
export function occupied(s: Sketch): number {
	let n = 0;
	for (let i = 0; i < HLL_M; i++) if ((s[i] ?? 0) > 0) n++;
	return n;
}

/**
 * The classic estimator. NOT FOR POLICY, and the name is deliberately not
 * `count`.
 *
 * DELIBERATELY NOT BIAS-CORRECTED. HLL++'s empirical bias tables move estimates
 * UP near the sparse/dense boundary, and up is the unsafe direction here.
 */
export function estimate(s: Sketch): number {
	let sum = 0;
	let zeros = 0;
	for (let i = 0; i < HLL_M; i++) {
		const r = s[i] ?? 0;
		sum += 2 ** -r;
		if (r === 0) zeros++;
	}
	// Linear counting below the range where the harmonic estimator behaves.
	if (zeros > 0) {
		const linear = HLL_M * Math.log(HLL_M / zeros);
		if (linear <= 2.5 * HLL_M) return linear;
	}
	const ALPHA = 0.7213 / (1 + 1.079 / HLL_M);
	return (ALPHA * HLL_M * HLL_M) / sum;
}

/**
 * A three-sigma one-sided haircut, at m = 4096.
 *
 * HLL's asymptotic relative standard error is 1.04/sqrt(m) = 1.625%, so three
 * sigma is 4.875% and the multiplier is 0.951. HONEST CAVEAT: that figure is
 * asymptotic and describes the classic estimator's mid-range. It is the design
 * basis, not a proof.
 */
const THREE_SIGMA_LOW = 0.951;
const THREE_SIGMA_HIGH = 1.049;

/**
 * The number the density floor and the corroboration bar consume.
 *
 * Below m/16 the occupied count is both exact and tight, so it is used directly
 * and there is no error term at all. Above it the registers saturate and the
 * haircut applies.
 */
export function lowerBound(s: Sketch): number {
	const occ = occupied(s);
	if (occ < HLL_M / 16) return occ;
	// max(), not a switch. A plain switch at the crossover steps DOWN: around
	// n = 264 the occupied count reads 255 while the haircut estimate reads 251,
	// so the bound drops by four as traffic grows. That direction is fail-safe, so
	// it is not a leak, but it is a cliff a band would ride down and back up
	// across the boundary — the oscillation the hysteresis exists to remove,
	// reintroduced underneath it. Found by a monotonicity test, not by reading.
	//
	// The floor of occupied() also keeps the certainty: whatever the estimator
	// says, the result is never below a bound that holds with confidence 1.
	return Math.max(occ, Math.floor(estimate(s) * THREE_SIGMA_LOW));
}

/**
 * The upper bound, used ONLY to decide when a crowd band may step DOWN.
 *
 * Bands rise on the lower bound and fall on the upper one, so both movements err
 * toward reporting less.
 */
export function upperBound(s: Sketch): number {
	const occ = occupied(s);
	if (occ < HLL_M / 16) return occ;
	return Math.ceil(estimate(s) * THREE_SIGMA_HIGH);
}
