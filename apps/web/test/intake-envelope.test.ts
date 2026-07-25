/**
 * The register body, end to end: sealed the way the browser seals it, framed
 * the way the wire carries it, structurally accepted by the api Worker's
 * check, and opened with the key the consumer holds.
 *
 * This is the test the old code could never have passed. metadataEnvelope()
 * minted a content key, sealed with it and dropped it, so every register body
 * satisfied the structural check and was permanently unreadable by everyone.
 */
import { describe, expect, it } from 'vitest';
import {
	NONCE_LENGTH,
	openSealedBox,
	sealTo,
	sealedBoxPublicKey
} from '@harborage/crypto/sealed-box';
import {
	ALG_SEALED_BOX_X25519,
	ALG_XCHACHA20POLY1305,
	frameEnvelope,
	isSealedEnvelope,
	MAX_ENVELOPE_LEN,
	unframeEnvelope
} from '@harborage/worker-lib/envelope';

const INTAKE_SK = new Uint8Array(32).fill(11);
const INTAKE_PK = sealedBoxPublicKey(INTAKE_SK);

const META = {
	type: 'teargas',
	note: 'Police used gas near the north gate at about 4pm.',
	area: 'North gate',
	occurred_date: '2026-07-25',
	redaction_confirmed: true
};

function browserSideEnvelope(meta: unknown): Uint8Array {
	const ephemeralSeed = new Uint8Array(32);
	const nonce = new Uint8Array(NONCE_LENGTH);
	crypto.getRandomValues(ephemeralSeed);
	crypto.getRandomValues(nonce);
	const boxed = sealTo(
		INTAKE_PK,
		new TextEncoder().encode(JSON.stringify(meta)),
		ephemeralSeed,
		nonce
	);
	ephemeralSeed.fill(0);
	return frameEnvelope(boxed, ALG_SEALED_BOX_X25519);
}

describe('register metadata envelope', () => {
	it('is accepted by the structural check and readable by the intake key', () => {
		const envelope = browserSideEnvelope(META);
		expect(isSealedEnvelope(envelope)).toBe(true);

		const unframed = unframeEnvelope(envelope);
		expect(unframed?.algId).toBe(ALG_SEALED_BOX_X25519);

		const plaintext = openSealedBox(INTAKE_SK, unframed!.sealed);
		expect(plaintext).not.toBeNull();
		expect(JSON.parse(new TextDecoder().decode(plaintext!))).toEqual(META);
	});

	it('is opaque to anyone without the intake key', () => {
		const envelope = browserSideEnvelope(META);
		const unframed = unframeEnvelope(envelope)!;
		expect(openSealedBox(new Uint8Array(32).fill(12), unframed.sealed)).toBeNull();
		// And the plaintext does not survive anywhere in the framed bytes.
		expect(new TextDecoder().decode(envelope)).not.toContain('north gate');
	});

	it('produces a different envelope every time for the same note', () => {
		const a = browserSideEnvelope(META);
		const b = browserSideEnvelope(META);
		expect(a).not.toEqual(b);
		// Both still open to the same plaintext.
		for (const e of [a, b]) {
			const p = openSealedBox(INTAKE_SK, unframeEnvelope(e)!.sealed);
			expect(JSON.parse(new TextDecoder().decode(p!))).toEqual(META);
		}
	});

	it('stays well inside the wire cap for a realistic note', () => {
		const long = { ...META, note: 'x'.repeat(2000) };
		expect(browserSideEnvelope(long).length).toBeLessThan(MAX_ENVELOPE_LEN);
	});

	// A sealed-box body truncated to the old XChaCha minimum would otherwise
	// still look structurally valid, because the length floor was global.
	it('applies a per-algorithm length floor', () => {
		const envelope = browserSideEnvelope(META);
		const truncated = envelope.subarray(0, 50);
		expect(isSealedEnvelope(truncated)).toBe(false);
		// The same 50 bytes relabelled as plain XChaCha clears the lower floor,
		// which is exactly why the floor has to move with the algorithm.
		const relabelled = truncated.slice();
		relabelled[4] = ALG_XCHACHA20POLY1305;
		expect(isSealedEnvelope(relabelled)).toBe(true);
	});

	it('rejects plain JSON, as it always did', () => {
		expect(isSealedEnvelope(new TextEncoder().encode(JSON.stringify(META)))).toBe(false);
	});
});
