import { describe, expect, it } from 'vitest';
import {
	ALG_XCHACHA20POLY1305,
	MAX_ENVELOPE_LEN,
	MIN_ENVELOPE_LEN,
	frameEnvelope,
	isSealedEnvelope,
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
