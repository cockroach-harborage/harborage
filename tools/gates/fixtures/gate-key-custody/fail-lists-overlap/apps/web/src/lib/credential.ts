// PASS fixture. The cache refuses a brokered compartment before minting.
import { ONE_SHOT_ONLY_COMPARTMENTS } from '@harborage/crypto/compartments';

async function certFor(compartment: Compartment) {
	if (ONE_SHOT_ONLY_COMPARTMENTS.includes(compartment))
		throw new Error(`${compartment} is one-shot only; use oneShotCredentialHeaders`);
	return cache.get(compartment) ?? mint(compartment);
}
