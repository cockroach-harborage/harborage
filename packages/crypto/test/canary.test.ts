import { describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { base64 } from '@scure/base';
import { checkCanary, parseCanaryExpiry } from '../src/canary.ts';

// ---- TEST-ONLY minisign signer (production canary signing is offline). --------
const SEED = new Uint8Array(32).fill(5);
const OTHER = new Uint8Array(32).fill(6);
const KEY_ID = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2]);
const enc = (s: string) => new TextEncoder().encode(s);

function pubLine(seed = SEED): string {
	const raw = new Uint8Array(42);
	raw.set(enc('Ed'), 0);
	raw.set(KEY_ID, 2);
	raw.set(ed25519.getPublicKey(seed), 10);
	return 'untrusted comment: canary\n' + base64.encode(raw);
}
function sign(text: string, seed = SEED, trusted = 'canary'): string {
	const sig = ed25519.sign(enc(text), seed);
	const raw = new Uint8Array(74);
	raw.set(enc('Ed'), 0);
	raw.set(KEY_ID, 2);
	raw.set(sig, 10);
	const global = ed25519.sign(new Uint8Array([...sig, ...enc(trusted)]), seed);
	return [
		'untrusted comment: sig',
		base64.encode(raw),
		'trusted comment: ' + trusted,
		base64.encode(global)
	].join('\n');
}

const T0 = Date.parse('2026-07-25T00:00:00Z');
const canaryText = (until: string) =>
	`Harborage warrant canary\nIssued: 2026-07-25\nValid until: ${until}\n`;

describe('parseCanaryExpiry', () => {
	it('reads the Valid until line', () => {
		expect(parseCanaryExpiry(canaryText('2026-08-25'))?.iso).toBe('2026-08-25');
	});
	it('returns null when absent', () => {
		expect(parseCanaryExpiry('no expiry here')).toBeNull();
	});
});

describe('checkCanary', () => {
	it('is unestablished with no pinned key (the M1 state)', () => {
		const text = canaryText('2026-08-25');
		expect(checkCanary(text, sign(text), [], T0).state).toBe('unestablished');
	});

	it('is unestablished with a pinned key but no signature', () => {
		expect(checkCanary(canaryText('2026-08-25'), '', [pubLine()], T0).state).toBe('unestablished');
	});

	it('is ok for a valid, in-date, pinned-key signature', () => {
		const text = canaryText('2026-08-25');
		const r = checkCanary(text, sign(text), [pubLine()], T0);
		expect(r.state).toBe('ok');
		expect(r.validUntil).toBe('2026-08-25');
	});

	it('is expired past the valid-until date (the signal)', () => {
		const text = canaryText('2026-07-01');
		expect(checkCanary(text, sign(text), [pubLine()], T0).state).toBe('expired');
	});

	it('is invalid when signed by a non-pinned key', () => {
		const text = canaryText('2026-08-25');
		expect(checkCanary(text, sign(text, OTHER), [pubLine()], T0).state).toBe('invalid');
	});

	it('is invalid when the text was altered after signing (extend-expiry attack)', () => {
		const signed = canaryText('2026-08-25');
		const sig = sign(signed);
		const tampered = canaryText('2027-12-31'); // compelled host tries to extend
		expect(checkCanary(tampered, sig, [pubLine()], T0).state).toBe('invalid');
	});
});
