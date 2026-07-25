import { sign, SIG_CONTEXT } from '@harborage/crypto/hkdf-tree';

export function attest(body: Uint8Array, sk: Uint8Array): Uint8Array {
	return sign(SIG_CONTEXT.pop, body, sk);
}
