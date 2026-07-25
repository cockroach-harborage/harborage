// PASS fixture. Account creation iterates the CACHED list and never names the
// server's ACTIVE list. The comment below deliberately mentions the forbidden
// identifier so the comment-stripping in the gate is exercised rather than
// assumed: ACTIVE_COMPARTMENTS is the server's list, not this device's.
import { ACTIVE_COMPARTMENTS } from '@harborage/crypto/compartments';

async function installTree(tier: string) {
	for (const compartment of ACTIVE_COMPARTMENTS) {
		await store.put(STORE_KEYS, await deriveKey(compartment, tier));
	}
}
