/**
 * Anonymous sealed box: ephemeral X25519 → HKDF-SHA-256 → XChaCha20-Poly1305.
 *
 * WHAT THIS IS FOR, precisely, because the custody claim is easy to overstate:
 * the incident metadata envelope (§19.1). That body is PUBLIC-PLAINTEXT-destined
 * — it is meant to become the public incident record — so the consumer Worker
 * MUST be able to read it. The platform therefore holds the private half.
 *
 * That makes this **SEALED-TO-PLATFORM, not end-to-end**. It buys hop
 * confidentiality and blast-radius hardening: the body is opaque in transit,
 * opaque sitting in the queue, and opaque to a compromised edge Worker or an
 * accidental log line. It buys NOTHING against legal compulsion, which is the
 * stated adversary. Never describe it as end-to-end. The evidence ORIGINAL is a
 * different object with a different claim (reporter + off-platform custodian,
 * no key on the platform, no unwrap endpoint).
 *
 * @noble only, and no WASM: ARCHITECTURE §5 confines libsodium to behind the
 * evidence vault, and a 2G phone should not load 300 KB of WASM to file a note.
 * This is the same construction as libsodium's crypto_box_seal with HKDF in
 * place of the blake2b nonce/key derivation.
 *
 * No ambient globals — the caller supplies randomness, so Workers can import it.
 *
 * Wire layout:  ephemeralPublicKey(32B) ‖ nonce(24B) ‖ ciphertext+tag
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { extract, expand } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

export const EPK_LENGTH = 32;
export const NONCE_LENGTH = 24;
const TAG_LENGTH = 16;
export const SEALED_BOX_OVERHEAD = EPK_LENGTH + NONCE_LENGTH + TAG_LENGTH;

const HKDF_SALT = new TextEncoder().encode('harborage/sealed-box/v1');

/**
 * Derive the content key from the ECDH secret, binding BOTH public keys into
 * the KDF info.
 *
 * The binding is what stops a captured ciphertext being re-presented as though
 * it had been sealed to a different recipient: change either key and the
 * derived key changes, so the tag stops verifying. Without it the ephemeral
 * public key is an unauthenticated attacker-chosen prefix.
 */
function contentKey(
	sharedSecret: Uint8Array,
	ephemeralPublicKey: Uint8Array,
	recipientPublicKey: Uint8Array
): Uint8Array {
	const info = new Uint8Array(ephemeralPublicKey.length + recipientPublicKey.length);
	info.set(ephemeralPublicKey, 0);
	info.set(recipientPublicKey, ephemeralPublicKey.length);
	return expand(sha256, extract(sha256, sharedSecret, HKDF_SALT), info, 32);
}

/**
 * Seal `plaintext` to `recipientPublicKey`.
 *
 * `ephemeralSeed` and `nonce` are parameters rather than generated here, both
 * so this module stays global-free and so a test can pin an exact ciphertext.
 * In production BOTH must come from a CSPRNG, and the ephemeral seed must never
 * be reused: reuse across two messages to the same recipient repeats the
 * content key, which is a catastrophic loss of confidentiality for both.
 */
export function sealTo(
	recipientPublicKey: Uint8Array,
	plaintext: Uint8Array,
	ephemeralSeed: Uint8Array,
	nonce: Uint8Array
): Uint8Array {
	if (recipientPublicKey.length !== EPK_LENGTH) throw new Error('recipient key must be 32 bytes');
	if (ephemeralSeed.length !== 32) throw new Error('ephemeral seed must be 32 bytes');
	if (nonce.length !== NONCE_LENGTH) throw new Error('nonce must be 24 bytes');

	const ephemeralPublicKey = x25519.getPublicKey(ephemeralSeed);
	const shared = x25519.getSharedSecret(ephemeralSeed, recipientPublicKey);
	const key = contentKey(shared, ephemeralPublicKey, recipientPublicKey);
	const ciphertext = xchacha20poly1305(key, nonce).encrypt(plaintext);

	const out = new Uint8Array(EPK_LENGTH + NONCE_LENGTH + ciphertext.length);
	out.set(ephemeralPublicKey, 0);
	out.set(nonce, EPK_LENGTH);
	out.set(ciphertext, EPK_LENGTH + NONCE_LENGTH);
	return out;
}

/**
 * Open a sealed box with the recipient's private key.
 *
 * Returns null rather than throwing: every input is untrusted, and the consumer
 * treats an unopenable body as a poison message rather than an exception.
 */
export function openSealedBox(
	recipientPrivateKey: Uint8Array,
	boxed: Uint8Array
): Uint8Array | null {
	if (boxed.length < SEALED_BOX_OVERHEAD) return null;
	if (recipientPrivateKey.length !== 32) return null;
	try {
		const ephemeralPublicKey = boxed.subarray(0, EPK_LENGTH);
		const nonce = boxed.subarray(EPK_LENGTH, EPK_LENGTH + NONCE_LENGTH);
		const ciphertext = boxed.subarray(EPK_LENGTH + NONCE_LENGTH);
		const recipientPublicKey = x25519.getPublicKey(recipientPrivateKey);
		const shared = x25519.getSharedSecret(recipientPrivateKey, ephemeralPublicKey);
		const key = contentKey(shared, ephemeralPublicKey, recipientPublicKey);
		return xchacha20poly1305(key, nonce).decrypt(ciphertext);
	} catch {
		return null;
	}
}

/** The public half to publish, from the private half held as a secret. */
export function sealedBoxPublicKey(recipientPrivateKey: Uint8Array): Uint8Array {
	return x25519.getPublicKey(recipientPrivateKey);
}
