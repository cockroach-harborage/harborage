import { describe, expect, it } from 'vitest';
import {
	ALG_BROKER_ONESHOT,
	ALG_SEALED_BOX_X25519,
	ALG_XCHACHA20POLY1305,
	BROKER_ENVELOPE_LEN,
	MAX_ENVELOPE_LEN,
	MIN_ENVELOPE_LEN,
	frameEnvelope,
	isSealedEnvelope,
	maxEnvelopeLen,
	unframeEnvelope
} from '../src/envelope.ts';

// A minimal stand-in for a seal() output: nonce(24) + tag(16). The predicate is
// structural — it never decrypts — so real ciphertext is not needed here.
const sealed = new Uint8Array(40).fill(1);

describe('sealed-envelope framing', () => {
	it('accepts a framed seal output', () => {
		expect(isSealedEnvelope(frameEnvelope(sealed))).toBe(true);
	});

	it('rejects a plain JSON body (the core sealed-body invariant)', () => {
		const json = new TextEncoder().encode(JSON.stringify({ incident: 'x', when: 'now' }));
		expect(isSealedEnvelope(json)).toBe(false);
	});

	it('rejects a body shorter than one seal', () => {
		expect(isSealedEnvelope(new Uint8Array(MIN_ENVELOPE_LEN - 1))).toBe(false);
	});

	it('rejects an oversize body', () => {
		expect(isSealedEnvelope(new Uint8Array(MAX_ENVELOPE_LEN + 1))).toBe(false);
	});

	it('rejects a wrong magic', () => {
		const bad = frameEnvelope(sealed);
		bad[0] = 0x00;
		expect(isSealedEnvelope(bad)).toBe(false);
	});

	it('rejects an unknown algorithm', () => {
		expect(isSealedEnvelope(frameEnvelope(sealed, 99))).toBe(false);
	});

	it('round-trips frame and unframe', () => {
		const framed = frameEnvelope(sealed, ALG_XCHACHA20POLY1305);
		const un = unframeEnvelope(framed);
		expect(un).not.toBeNull();
		expect(un!.algId).toBe(ALG_XCHACHA20POLY1305);
		expect(Array.from(un!.sealed)).toEqual(Array.from(sealed));
	});
});

describe('per-algorithm size ceiling', () => {
	/**
	 * The broker lane wants EXACTLY one size, not merely "not enormous". Two
	 * phases of different sizes would be a phase oracle visible to anyone
	 * watching the connection, so the ceiling equals the floor and the framing
	 * carries the rule rather than each handler remembering it.
	 *
	 * Revert to the single global 8 KiB cap and the first assertion goes red
	 * while the second stays green, which is what makes this a test of the
	 * PER-ALGORITHM ceiling rather than of the global one.
	 */
	it('refuses an oversize broker frame while allowing the same size on another lane', () => {
		const big = new Uint8Array(6 * 1024);
		expect(isSealedEnvelope(frameEnvelope(big, ALG_BROKER_ONESHOT))).toBe(false);
		expect(isSealedEnvelope(frameEnvelope(big, ALG_SEALED_BOX_X25519))).toBe(true);
	});

	it('refuses an undersize broker frame', () => {
		const small = new Uint8Array(1024);
		expect(isSealedEnvelope(frameEnvelope(small, ALG_BROKER_ONESHOT))).toBe(false);
	});

	it('accepts a broker frame at exactly one frame long', () => {
		const exact = new Uint8Array(BROKER_ENVELOPE_LEN - 5);
		const framed = frameEnvelope(exact, ALG_BROKER_ONESHOT);
		expect(framed.length).toBe(BROKER_ENVELOPE_LEN);
		expect(isSealedEnvelope(framed)).toBe(true);
		expect(unframeEnvelope(framed)?.algId).toBe(ALG_BROKER_ONESHOT);
	});

	it('reports the right ceiling per algorithm', () => {
		expect(maxEnvelopeLen(ALG_BROKER_ONESHOT)).toBe(BROKER_ENVELOPE_LEN);
		expect(maxEnvelopeLen(ALG_SEALED_BOX_X25519)).toBe(MAX_ENVELOPE_LEN);
		// An unknown algorithm falls back to the global cap rather than to no cap.
		expect(maxEnvelopeLen(99)).toBe(MAX_ENVELOPE_LEN);
	});
});
