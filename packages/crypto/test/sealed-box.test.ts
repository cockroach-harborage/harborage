import { describe, expect, it } from 'vitest';
import { x25519 } from '@noble/curves/ed25519.js';
import {
	EPK_LENGTH,
	NONCE_LENGTH,
	SEALED_BOX_OVERHEAD,
	openSealedBox,
	sealTo,
	sealedBoxPublicKey
} from '../src/sealed-box.ts';

const enc = new TextEncoder();
const RECIPIENT_SK = new Uint8Array(32).fill(3);
const RECIPIENT_PK = sealedBoxPublicKey(RECIPIENT_SK);
const EPH = new Uint8Array(32).fill(5);
const NONCE = new Uint8Array(NONCE_LENGTH).fill(9);
const MESSAGE = enc.encode('{"type":"teargas","area":"north gate"}');

function flip(buf: Uint8Array, index: number, mask = 0xff): Uint8Array {
	buf[index] = (buf[index] ?? 0) ^ mask;
	return buf;
}

describe('sealed box', () => {
	it('round-trips', () => {
		const boxed = sealTo(RECIPIENT_PK, MESSAGE, EPH, NONCE);
		expect(boxed.length).toBe(SEALED_BOX_OVERHEAD + MESSAGE.length);
		expect(openSealedBox(RECIPIENT_SK, boxed)).toEqual(MESSAGE);
	});

	it('agrees with the recipient key derived independently', () => {
		expect(sealedBoxPublicKey(RECIPIENT_SK)).toEqual(x25519.getPublicKey(RECIPIENT_SK));
	});

	it('cannot be opened by anyone else', () => {
		const boxed = sealTo(RECIPIENT_PK, MESSAGE, EPH, NONCE);
		expect(openSealedBox(new Uint8Array(32).fill(4), boxed)).toBeNull();
	});

	it('is anonymous: the box carries no sender identity', () => {
		const a = sealTo(RECIPIENT_PK, MESSAGE, new Uint8Array(32).fill(1), NONCE);
		const b = sealTo(RECIPIENT_PK, MESSAGE, new Uint8Array(32).fill(2), NONCE);
		// Different ephemeral keys, so the two boxes share nothing that would let
		// a reader tell they came from the same device.
		expect(a.subarray(0, EPK_LENGTH)).not.toEqual(b.subarray(0, EPK_LENGTH));
		expect(a.subarray(EPK_LENGTH + NONCE_LENGTH)).not.toEqual(b.subarray(EPK_LENGTH + NONCE_LENGTH));
	});

	// The ephemeral public key is an attacker-chosen prefix. Binding both keys
	// into the KDF is what stops a captured ciphertext being re-presented as
	// though it had been sealed to a different recipient.
	it('rejects a swapped ephemeral public key', () => {
		const boxed = sealTo(RECIPIENT_PK, MESSAGE, EPH, NONCE);
		const swapped = boxed.slice();
		swapped.set(x25519.getPublicKey(new Uint8Array(32).fill(7)), 0);
		expect(openSealedBox(RECIPIENT_SK, swapped)).toBeNull();
	});

	it('rejects tampering anywhere in the box', () => {
		const boxed = sealTo(RECIPIENT_PK, MESSAGE, EPH, NONCE);
		for (const offset of [0, 31, EPK_LENGTH, EPK_LENGTH + 5, boxed.length - 1]) {
			expect(openSealedBox(RECIPIENT_SK, flip(boxed.slice(), offset))).toBeNull();
		}
	});

	it('rejects truncation and junk', () => {
		const boxed = sealTo(RECIPIENT_PK, MESSAGE, EPH, NONCE);
		expect(openSealedBox(RECIPIENT_SK, boxed.subarray(0, boxed.length - 1))).toBeNull();
		expect(openSealedBox(RECIPIENT_SK, new Uint8Array(10))).toBeNull();
		expect(openSealedBox(RECIPIENT_SK, new Uint8Array(0))).toBeNull();
		expect(openSealedBox(new Uint8Array(31), boxed)).toBeNull();
	});

	it('handles an empty plaintext', () => {
		const boxed = sealTo(RECIPIENT_PK, new Uint8Array(0), EPH, NONCE);
		expect(openSealedBox(RECIPIENT_SK, boxed)).toEqual(new Uint8Array(0));
	});

	it('refuses wrong-size inputs rather than producing a weak box', () => {
		expect(() => sealTo(new Uint8Array(31), MESSAGE, EPH, NONCE)).toThrow();
		expect(() => sealTo(RECIPIENT_PK, MESSAGE, new Uint8Array(31), NONCE)).toThrow();
		expect(() => sealTo(RECIPIENT_PK, MESSAGE, EPH, new Uint8Array(12))).toThrow();
	});

	// Not a property of the construction, but a property callers must preserve:
	// the same ephemeral seed twice repeats the content key.
	it('produces identical bytes for identical inputs, which is why seeds must be fresh', () => {
		expect(sealTo(RECIPIENT_PK, MESSAGE, EPH, NONCE)).toEqual(
			sealTo(RECIPIENT_PK, MESSAGE, EPH, NONCE)
		);
	});
});
