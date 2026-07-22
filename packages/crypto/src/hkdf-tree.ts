/**
 * Unlinkable per-compartment identity derivation (§5.1).
 * rootKey = HKDF-Extract(salt="harborage/v1", IKM=seed)
 * seed_c  = HKDF-Expand(rootKey, "compartment/"+domain+"/"+epoch, 32)
 * Per-request identities fold a nonce into the info string.
 *
 * Honest limit: this is unlinkability at the key/transport layer only. Content
 * (stylometry, verbatim detail) and shared IP/timing can re-link compartments.
 */
import { extract, expand } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';

const SALT = new TextEncoder().encode('harborage/v1');

export interface SigningKeypair {
	secretKey: Uint8Array;
	publicKey: Uint8Array;
}

export interface BoxKeypair {
	secretKey: Uint8Array;
	publicKey: Uint8Array;
}

export function rootKeyFromSeed(seed: Uint8Array): Uint8Array {
	return extract(sha256, seed, SALT);
}

export function compartmentSeed(rootKey: Uint8Array, domain: string, epoch: number): Uint8Array {
	const info = new TextEncoder().encode(`compartment/${domain}/${epoch}`);
	return expand(sha256, rootKey, info, 32);
}

/** Per-request identity: a fresh nonce yields an unlinkable one-shot key. */
export function requestSeed(rootKey: Uint8Array, domain: string, epoch: number, nonce: Uint8Array): Uint8Array {
	const prefix = new TextEncoder().encode(`request/${domain}/${epoch}/`);
	const info = new Uint8Array(prefix.length + nonce.length);
	info.set(prefix);
	info.set(nonce, prefix.length);
	return expand(sha256, rootKey, info, 32);
}

export function signingKeypair(seed32: Uint8Array): SigningKeypair {
	if (seed32.length !== 32) throw new Error('signing seed must be 32 bytes');
	return { secretKey: seed32, publicKey: ed25519.getPublicKey(seed32) };
}

export function boxKeypair(seed32: Uint8Array): BoxKeypair {
	if (seed32.length !== 32) throw new Error('box seed must be 32 bytes');
	return { secretKey: seed32, publicKey: x25519.getPublicKey(seed32) };
}

export function sign(message: Uint8Array, secretKey: Uint8Array): Uint8Array {
	return ed25519.sign(message, secretKey);
}

export function verify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean {
	try {
		return ed25519.verify(signature, message, publicKey);
	} catch {
		return false;
	}
}

export function sharedSecret(secretKey: Uint8Array, theirPublicKey: Uint8Array): Uint8Array {
	return x25519.getSharedSecret(secretKey, theirPublicKey);
}
