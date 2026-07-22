/**
 * Client-side sealing: XChaCha20-Poly1305 (§5.4). The Worker and edge only
 * ever see ciphertext; the platform holds no key and no unwrap endpoint.
 * Envelope layout: nonce(24) || ciphertext+tag.
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';

const NONCE_LENGTH = 24;

export function newContentKey(): Uint8Array {
	const key = new Uint8Array(32);
	globalThis.crypto.getRandomValues(key);
	return key;
}

export function seal(key: Uint8Array, plaintext: Uint8Array, aad?: Uint8Array): Uint8Array {
	const nonce = new Uint8Array(NONCE_LENGTH);
	globalThis.crypto.getRandomValues(nonce);
	const ciphertext = xchacha20poly1305(key, nonce, aad).encrypt(plaintext);
	const envelope = new Uint8Array(NONCE_LENGTH + ciphertext.length);
	envelope.set(nonce);
	envelope.set(ciphertext, NONCE_LENGTH);
	return envelope;
}

/** Throws on any tamper (wrong key, modified bytes, wrong aad). */
export function open(key: Uint8Array, envelope: Uint8Array, aad?: Uint8Array): Uint8Array {
	if (envelope.length < NONCE_LENGTH + 16) throw new Error('envelope too short');
	const nonce = envelope.subarray(0, NONCE_LENGTH);
	const ciphertext = envelope.subarray(NONCE_LENGTH);
	return xchacha20poly1305(key, nonce, aad).decrypt(ciphertext);
}
