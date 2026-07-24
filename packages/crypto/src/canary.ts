/**
 * Warrant-canary verification (ARCHITECTURE §10.4, §17.7). The canary is a
 * human-produced statement signed OFFLINE with the project canary key and
 * published to /.well-known/canary.txt with a hard expiry. Signing stays manual
 * and offline by design: automating it would let a compelled host keep the
 * canary alive, which is a security bug. This module only VERIFIES.
 *
 * The signal is the ABSENCE of a fresh valid signature: missing, invalid, or
 * expired all read as "not currently confirmed" and move the app to a protective
 * posture. Until the offline key ceremony pins a canary key, the state is
 * `unestablished` — honest, never a false all-clear.
 */
import { parsePublicKey, verifyMinisign } from './minisign.ts';

export type CanaryState = 'ok' | 'expired' | 'invalid' | 'unestablished';

export interface CanaryCheck {
	state: CanaryState;
	/** ISO date the canary is valid until, when parseable. */
	validUntil?: string;
}

/** Parse a `Valid until: YYYY-MM-DD` line into an epoch-ms deadline, or null. */
export function parseCanaryExpiry(text: string): { iso: string; ms: number } | null {
	const m = text.match(/Valid until:\s*(\d{4}-\d{2}-\d{2})/i);
	if (!m) return null;
	const ms = Date.parse(`${m[1]}T23:59:59Z`);
	if (Number.isNaN(ms)) return null;
	return { iso: m[1]!, ms };
}

/**
 * Verify the canary text against a detached minisign signature and a pinned key,
 * then check freshness. `nowMs` is passed in (device clock) so this stays pure
 * and testable. No pinned key or no signature ⇒ `unestablished` (the M1 state).
 */
export function checkCanary(
	text: string,
	signatureFile: string,
	pinnedPublicKeys: readonly string[],
	nowMs: number
): CanaryCheck {
	if (pinnedPublicKeys.length === 0 || !signatureFile) return { state: 'unestablished' };

	const bytes = new TextEncoder().encode(text);
	const verified = pinnedPublicKeys.some((k) => {
		try {
			return verifyMinisign(parsePublicKey(k), bytes, signatureFile).valid;
		} catch {
			return false;
		}
	});
	if (!verified) return { state: 'invalid' };

	const expiry = parseCanaryExpiry(text);
	if (!expiry) return { state: 'expired' };
	if (nowMs > expiry.ms) return { state: 'expired', validUntil: expiry.iso };
	return { state: 'ok', validUntil: expiry.iso };
}
