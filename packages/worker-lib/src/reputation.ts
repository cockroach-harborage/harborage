/**
 * Reputation INPUTS (ARCHITECTURE §15). M2 scope, deliberately narrow.
 *
 * What this does: accrue, decay, and gate participation.
 * What this does NOT do: touch reach. Nothing here multiplies into ranking —
 * that is the M3 corroboration-reach machinery, and until it exists with CIB
 * detection and cohort-pivot alongside it, wiring reputation to reach would be
 * an unguarded amplification lever.
 *
 * THE SPINE, from §15: reach is never a function of raw engagement. Votes and
 * flags are INPUTS to the state machine, never OUTPUTS to the ranker. A mob can
 * generate unlimited votes; it cannot cheaply generate independent corroboration
 * or settled outcomes, and only those move anything.
 *
 * Reputation is OUTCOME-SETTLED — earned when items reach terminal-ish states,
 * not by receiving votes — per-compartment, √-damped so a whale cannot dominate,
 * and decaying so a dormant high-rep account is not a permanent asset.
 *
 * DOCUMENTED LIMIT (§15, stated so nobody mistakes this for a defence): none of
 * this resists a patient adversary. Caps, decay and outcome-settlement all
 * assume the attacker misbehaves early; they do nothing against an account that
 * behaves well for weeks and then pivots. That is precisely why the autonomous
 * ceiling stays low and naming stays human-gated.
 */

/** Scalars are thousandths so they stay integers on the wire and in D1. */
export const SCALAR_SCALE = 1000;

/** A new account is near-powerless: r0 ≈ 0.05. */
export const INITIAL_SCALAR_MILLI = 50;

/** Ceiling on r, so no account becomes structurally decisive. */
export const MAX_SCALAR_MILLI = 1000;

/**
 * Participation gate. Below r_gate a vote or flag counts ONLY as input to the
 * human queue and the coordination detector — never toward an autonomous state
 * change or any reach change. This is what makes a farm of fresh accounts
 * useless for anything except being noticed.
 */
export const R_GATE_MILLI = 150;

/** Reputation half-life, ~60 days. */
export const HALF_LIFE_DAYS = 60;

/** Most a single account may gain in one epoch, so farming stays slow. */
export const MAX_EPOCH_GAIN_MILLI = 100;

/** Cap on any single account's contribution to one cluster's weight. */
export const CLUSTER_CAP = 1.0;

export function meetsGate(scalarMilli: number): boolean {
	return scalarMilli >= R_GATE_MILLI;
}

/**
 * √-damped vote weight. The square root is the whole point: doubling reputation
 * does not double influence, so accumulating a large scalar has sharply
 * diminishing returns and a whale cannot dominate a cluster.
 *
 * Below the gate the weight is zero, not merely small — a sub-gate account must
 * contribute nothing at all to an autonomous decision.
 */
export function voteWeight(scalarMilli: number): number {
	if (!meetsGate(scalarMilli)) return 0;
	const r = Math.min(scalarMilli, MAX_SCALAR_MILLI) / SCALAR_SCALE;
	return Math.sqrt(r);
}

/**
 * Cluster-capped corroboration weight: C = Σ_clusters min(clusterCap, Σ √r).
 *
 * The cap is what makes Sybil clusters expensive. Ten accounts inside one
 * behavioural cluster contribute what one does; the attacker needs genuinely
 * distinct clusters, which is the wall §15 is honest about being climbable by a
 * resourced adversary — expensive, not impossible.
 */
export function corroborationWeight(clusters: readonly number[][]): number {
	let total = 0;
	for (const cluster of clusters) {
		let sum = 0;
		for (const scalarMilli of cluster) sum += voteWeight(scalarMilli);
		total += Math.min(CLUSTER_CAP, sum);
	}
	return total;
}

/**
 * Exponential decay by elapsed days. Applied on read rather than by a sweep, so
 * a dormant account's stored value is not silently authoritative.
 */
export function decay(scalarMilli: number, elapsedDays: number): number {
	if (elapsedDays <= 0) return scalarMilli;
	const decayed = scalarMilli * Math.pow(0.5, elapsedDays / HALF_LIFE_DAYS);
	return Math.max(0, Math.round(decayed));
}

/**
 * Apply a settled outcome. Gains are capped per epoch; losses are not, because
 * the asymmetry is deliberate: being wrong should cost more quickly than being
 * right earns. Flaggers who pile onto a later-verified item lose reputation,
 * which is what makes a flag storm expensive rather than free.
 */
export function settle(
	scalarMilli: number,
	deltaMilli: number,
	gainedThisEpochMilli: number
): { scalarMilli: number; gainedThisEpochMilli: number } {
	if (deltaMilli <= 0) {
		return {
			scalarMilli: Math.max(0, scalarMilli + deltaMilli),
			gainedThisEpochMilli
		};
	}
	const room = Math.max(0, MAX_EPOCH_GAIN_MILLI - gainedThisEpochMilli);
	const granted = Math.min(deltaMilli, room);
	return {
		scalarMilli: Math.min(MAX_SCALAR_MILLI, scalarMilli + granted),
		gainedThisEpochMilli: gainedThisEpochMilli + granted
	};
}

/**
 * Per-item dedup token: HMAC(salt, keyHash).
 *
 * The salt is per-item and random, so a token is meaningless outside its item,
 * and it is destroyed when the corroboration window closes. Read the header of
 * migrations/0011_corroborations.sql for the honest limit: while the salt
 * exists, this is a membership oracle over one item's corroborators, and PITR
 * keeps it ~30 days regardless. The oracle-free construction needs blind tokens
 * and is M3.
 */
export async function dedupToken(salt: Uint8Array, keyHash: Uint8Array): Promise<string> {
	const key = await crypto.subtle.importKey(
		'raw',
		salt as BufferSource,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const mac = await crypto.subtle.sign('HMAC', key, keyHash as BufferSource);
	return Array.from(new Uint8Array(mac).slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join(
		''
	);
}
