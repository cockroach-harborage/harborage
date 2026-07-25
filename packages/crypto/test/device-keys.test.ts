/**
 * Conformance between the WebCrypto custody path and the noble path.
 *
 * These two must not drift. The browser derives keys through WebCrypto so the
 * root can be non-extractable; every test fixture, the Worker verifier, and the
 * `memory-only` tier use noble. If they ever disagree, a user's key silently
 * changes between devices or tiers and their account is gone with no error
 * anywhere. Node 22 supplies the same WebCrypto the browser does, so this runs
 * in plain vitest.
 */
import { describe, expect, it } from 'vitest';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { p256 } from '@noble/curves/nist.js';
import { compartmentSeed, requestSeed, rootKeyFromSeed, sign } from '../src/hkdf-tree.ts';
import { SIG_CONTEXT, SIGNING_ALG, PUBLIC_KEY_LENGTH, SIGNATURE_LENGTH } from '../src/compartments.ts';
import {
	detectCustodyTier,
	deriveCompartmentSeed,
	deriveRequestSeed,
	importBoxKey,
	importRootKey,
	importSigningKey,
	signWithDeviceKey,
	verifyDeviceSignature,
	zero
} from '../src/device-keys.ts';

const enc = new TextEncoder();
const SEED64 = new Uint8Array(64).fill(7);

describe('WebCrypto custody matches the noble tree', () => {
	it('derives byte-identical compartment seeds', async () => {
		const root = await importRootKey(SEED64);
		const noble = rootKeyFromSeed(SEED64);
		for (const [domain, epoch] of [
			['document', 1],
			['directory', 1],
			['document', 2],
			['legal', 99]
		] as const) {
			expect(await deriveCompartmentSeed(root, domain, epoch)).toEqual(
				compartmentSeed(noble, domain, epoch)
			);
		}
	});

	it('derives byte-identical per-request seeds', async () => {
		const root = await importRootKey(SEED64);
		const noble = rootKeyFromSeed(SEED64);
		const nonce = enc.encode('nonce-a');
		expect(await deriveRequestSeed(root, 'medical', 1, nonce)).toEqual(
			requestSeed(noble, 'medical', 1, nonce)
		);
	});

	it('separates compartments and epochs', async () => {
		const root = await importRootKey(SEED64);
		const a = await deriveCompartmentSeed(root, 'document', 1);
		expect(a).not.toEqual(await deriveCompartmentSeed(root, 'directory', 1));
		expect(a).not.toEqual(await deriveCompartmentSeed(root, 'document', 2));
	});
});

describe('secure-curve tier', () => {
	it('produces the same public key and the same signature as noble', async () => {
		const seed = new Uint8Array(32).fill(3);
		const key = await importSigningKey(seed, 'secure-curve');
		expect(key.algId).toBe(SIGNING_ALG.ed25519);
		expect(key.publicKey).toEqual(ed25519.getPublicKey(seed));
		expect(key.publicKey.length).toBe(PUBLIC_KEY_LENGTH[SIGNING_ALG.ed25519]);

		const msg = enc.encode('same bytes either way');
		const viaDevice = await signWithDeviceKey(key, SIG_CONTEXT.capCert, msg);
		const viaNoble = sign(SIG_CONTEXT.capCert, msg, seed);
		// Ed25519 is deterministic (RFC 8032), so this is byte equality, not
		// merely "both verify". A tier switch must be invisible.
		expect(viaDevice).toEqual(viaNoble);
		expect(viaDevice.length).toBe(SIGNATURE_LENGTH);
	});

	it('holds the private key non-extractably', async () => {
		const key = await importSigningKey(new Uint8Array(32).fill(3), 'secure-curve');
		expect(key.privateKey.extractable).toBe(false);
		await expect(globalThis.crypto.subtle.exportKey('pkcs8', key.privateKey)).rejects.toThrow();
	});

	it('agrees with noble on X25519 public keys', async () => {
		const seed = new Uint8Array(32).fill(5);
		const box = await importBoxKey(seed, 'secure-curve');
		expect(box.publicKey).toEqual(x25519.getPublicKey(seed));
		expect(box.privateKey.extractable).toBe(false);
	});
});

describe('p256 fallback tier', () => {
	// ECDSA is randomised, and half of WebCrypto's signatures have high S while
	// noble's verify rejects those by default. A single-shot assertion passes on
	// a coin flip, so this loops: a wrong `lowS`/`prehash` setting shows up as
	// "sending randomly fails, but only on older phones", which is close to
	// undebuggable in the field.
	it('verifies every signature it produces, not just half of them', async () => {
		const seed = new Uint8Array(32).fill(11);
		const key = await importSigningKey(seed, 'p256');
		expect(key.algId).toBe(SIGNING_ALG.ecdsaP256);
		expect(key.publicKey.length).toBe(PUBLIC_KEY_LENGTH[SIGNING_ALG.ecdsaP256]);
		expect(key.privateKey.extractable).toBe(false);

		for (let i = 0; i < 32; i++) {
			const msg = enc.encode(`fallback tier ${i}`);
			const sig = await signWithDeviceKey(key, SIG_CONTEXT.pop, msg);
			expect(sig.length).toBe(SIGNATURE_LENGTH);
			expect(verifyDeviceSignature(key.algId, key.publicKey, sig, SIG_CONTEXT.pop, msg)).toBe(true);
		}
	});

	it('is deterministic across imports', async () => {
		const seed = new Uint8Array(32).fill(11);
		const a = await importSigningKey(seed, 'p256');
		const b = await importSigningKey(seed, 'p256');
		expect(a.publicKey).toEqual(b.publicKey);
	});

	it('maps every seed to a valid scalar, including the extremes', async () => {
		for (const fill of [0x00, 0x01, 0xff]) {
			const key = await importSigningKey(new Uint8Array(32).fill(fill), 'p256');
			expect(() => p256.Point.fromBytes(key.publicKey)).not.toThrow();
		}
	});
});

describe('cross-tier and cross-context isolation', () => {
	it('does not verify a signature under the wrong context', async () => {
		const key = await importSigningKey(new Uint8Array(32).fill(3), 'secure-curve');
		const msg = enc.encode('body');
		const sig = await signWithDeviceKey(key, SIG_CONTEXT.capCert, msg);
		expect(verifyDeviceSignature(key.algId, key.publicKey, sig, SIG_CONTEXT.capCert, msg)).toBe(
			true
		);
		expect(verifyDeviceSignature(key.algId, key.publicKey, sig, SIG_CONTEXT.pop, msg)).toBe(false);
	});

	it('does not verify a signature under the wrong algorithm id', async () => {
		const key = await importSigningKey(new Uint8Array(32).fill(3), 'secure-curve');
		const msg = enc.encode('body');
		const sig = await signWithDeviceKey(key, SIG_CONTEXT.capCert, msg);
		expect(
			verifyDeviceSignature(SIGNING_ALG.ecdsaP256, key.publicKey, sig, SIG_CONTEXT.capCert, msg)
		).toBe(false);
	});

	it('rejects a tampered message', async () => {
		const key = await importSigningKey(new Uint8Array(32).fill(11), 'p256');
		const sig = await signWithDeviceKey(key, SIG_CONTEXT.pop, enc.encode('body'));
		expect(
			verifyDeviceSignature(key.algId, key.publicKey, sig, SIG_CONTEXT.pop, enc.encode('bodz'))
		).toBe(false);
	});

	it('refuses to mint a key on the read-only tier', async () => {
		await expect(importSigningKey(new Uint8Array(32), 'memory-only')).rejects.toThrow();
		await expect(importBoxKey(new Uint8Array(32), 'memory-only')).rejects.toThrow();
	});
});

describe('housekeeping', () => {
	it('detects a usable tier under Node WebCrypto', async () => {
		expect(await detectCustodyTier()).toBe('secure-curve');
	});

	it('zeroes key material in place', () => {
		const b = new Uint8Array([1, 2, 3]);
		zero(b);
		expect(b).toEqual(new Uint8Array([0, 0, 0]));
	});
});
