import { ed25519 } from '@noble/curves/ed25519.js';

export function attest(body: Uint8Array, sk: Uint8Array): Uint8Array {
	return ed25519.sign(body, sk);
}
