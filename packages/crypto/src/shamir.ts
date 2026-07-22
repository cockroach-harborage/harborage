/**
 * Shamir secret sharing over GF(256) (§5.4 Tier B key custody), via Privy's
 * audited implementation (Cure53 + Zellic). Raw SSS — no SLIP-39 (no audited
 * JS implementation exists; treat SLIP-39 as build-vs-defer).
 *
 * Quorum topology is policy, not math: the offshore custodian's share is
 * mandatory in every quorum (§5.4) — enforced by who holds which share.
 */
import { split, combine } from 'shamir-secret-sharing';

export async function splitSecret(
	secret: Uint8Array,
	shares: number,
	threshold: number
): Promise<Uint8Array[]> {
	if (threshold < 2 || threshold > shares) throw new Error('invalid threshold');
	return split(secret, shares, threshold);
}

export async function combineShares(shares: Uint8Array[]): Promise<Uint8Array> {
	if (shares.length < 2) throw new Error('need at least 2 shares');
	return combine(shares);
}
