/**
 * Warrant-canary client check (ARCHITECTURE §10.4, §17.7). Fetches the published
 * canary + its detached signature and verifies against the pinned canary key.
 * The absence of a fresh valid signature is the signal: missing/invalid/expired
 * moves the app to a protective posture. The verification + freshness logic lives
 * in the frozen crypto module (CODEOWNERS); this binds it to the pinned key.
 *
 * PINNED_CANARY_PUBKEYS is empty until the offline key ceremony, so the state is
 * `unestablished` — honest, never a false all-clear.
 */
import { checkCanary, type CanaryCheck } from '@harborage/crypto/canary';

export const PINNED_CANARY_PUBKEYS: readonly string[] = [];

/**
 * Load and check the canary. Returns `unestablished` when the file, its
 * signature, or the pinned key is absent — the M1 state and the fail posture.
 */
export async function loadCanary(
	nowMs: number,
	fetchFn: typeof fetch = fetch
): Promise<CanaryCheck> {
	try {
		const [textRes, sigRes] = await Promise.all([
			fetchFn('/.well-known/canary.txt'),
			fetchFn('/.well-known/canary.txt.minisig')
		]);
		const text = textRes.ok ? await textRes.text() : '';
		const sig = sigRes.ok ? await sigRes.text() : '';
		if (!text) return { state: 'unestablished' };
		return checkCanary(text, sig, PINNED_CANARY_PUBKEYS, nowMs);
	} catch {
		return { state: 'unestablished' };
	}
}
