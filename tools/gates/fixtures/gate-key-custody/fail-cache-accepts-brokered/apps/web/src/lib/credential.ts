// PASS fixture. The cache refuses a brokered compartment before minting.
import { ONE_SHOT_ONLY_COMPARTMENTS } from '@harborage/crypto/compartments';

async function certFor(compartment: Compartment) {
	return cache.get(compartment) ?? mint(compartment);
}
