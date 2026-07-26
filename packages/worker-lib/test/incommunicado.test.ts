/**
 * The incommunicado bar (ARCHITECTURE §8.3).
 *
 * Firing a false alert is not a harmless mistake: it wastes the response capacity
 * of the people who would otherwise be helping someone real. So every test here is
 * a way a single actor could reach the bar alone, and must not.
 *
 * The suite injects a real legal_broker directory. With the production directory
 * empty every call refuses, so a suite that used only the resting state would pass
 * against `return {fire: false}` — every refusal below is measured against a
 * control that genuinely fires.
 */
import { describe, expect, it } from 'vitest';
import { SIG_CONTEXT } from '@harborage/crypto/compartments';
import { sign, signingKeypair } from '@harborage/crypto/hkdf-tree';
import type { KeyDirectoryEntry } from '@harborage/crypto/notice';
import {
	BROKER_MIN_KEYS,
	BROKER_REQUIRED,
	incommunicadoEvent,
	shouldFire,
	tickOf,
	TRIGGERS_REQUIRED,
	TRIGGER_TICK_MS,
	TRIGGER_WINDOW_MS,
	triggerMessage,
	type Trigger
} from '../src/incommunicado.ts';

const REF = 'a'.repeat(64);
const EPOCH = 9;
const NOW = 1_785_000_000_000;
const NOW_TICK = tickOf(NOW);
const BROKER_HASH = new Uint8Array(32).fill(7);

function b64(bytes: Uint8Array): string {
	let out = '';
	for (const b of bytes) out += String.fromCharCode(b);
	return btoa(out);
}

function kp(seed: number) {
	const priv = new Uint8Array(32).fill(seed);
	return { priv, pub: signingKeypair(priv).publicKey };
}

function trigger(seed: number, over: Partial<Trigger> = {}): Trigger {
	const k = kp(seed);
	return {
		keyIdHex: `key${seed}`,
		publicKeyB64: b64(k.pub),
		sigB64: b64(sign(SIG_CONTEXT.legalTrigger, triggerMessage(REF, EPOCH), k.priv)),
		tick: NOW_TICK,
		...over
	};
}

function brokerEntry(id: string, seed: number, role = 'legal_broker'): KeyDirectoryEntry {
	return {
		key_id: id,
		public_key: b64(kp(seed).pub),
		role,
		valid_from_epoch: 1,
		valid_to_epoch: null
	};
}

const BROKER_DIR = [brokerEntry('b1', 51), brokerEntry('b2', 52), brokerEntry('b3', 53)];

function brokerSig(seed: number, id: string) {
	return { key_id: id, sig: b64(sign(SIG_CONTEXT.legalBroker, BROKER_HASH, kp(seed).priv)) };
}

function call(over: Partial<Parameters<typeof shouldFire>[0]> = {}) {
	return shouldFire({
		refHash: REF,
		triggerEpoch: EPOCH,
		triggers: [trigger(41), trigger(42, { tick: NOW_TICK - 1 })],
		brokerSignatures: [brokerSig(51, 'b1')],
		brokerMessageHash: BROKER_HASH,
		directory: BROKER_DIR,
		revocations: [],
		nowMs: NOW,
		...over
	});
}

describe('the control fires, so the refusals below mean something', () => {
	it('fires with two distinct keys on separate ticks and a broker signature', () => {
		expect(call()).toEqual({ fire: true });
	});
});

describe('one actor cannot reach the bar alone', () => {
	/**
	 * TWO KEYS, NOT TWO SIGNATURES. One lawyer holding two keys is still one lawyer,
	 * and the whole point of the rule is that a second person acted.
	 */
	it('refuses two triggers from the same key', () => {
		const same = [trigger(41), trigger(41, { tick: NOW_TICK - 1 })];
		expect(call({ triggers: same })).toEqual({ fire: false, reason: 'same-key' });
	});

	/**
	 * SEPARATELY TICKED. Two requests inside one tick are one action with two
	 * signatures attached — precisely what a script does, and precisely what the
	 * two-trigger rule exists to exclude.
	 */
	it('refuses two triggers that arrived on the same tick', () => {
		const together = [trigger(41), trigger(42)];
		expect(call({ triggers: together })).toEqual({ fire: false, reason: 'same-tick' });
	});

	it('refuses a single trigger', () => {
		expect(call({ triggers: [trigger(41)] })).toEqual({
			fire: false,
			reason: 'not-enough-triggers'
		});
		expect(TRIGGERS_REQUIRED).toBe(2);
	});

	it('refuses no triggers at all', () => {
		expect(call({ triggers: [] }).fire).toBe(false);
	});
});

describe('signatures are checked, and bound to this ref and epoch', () => {
	it('refuses a trigger whose signature does not verify', () => {
		const forged = trigger(41, { sigB64: b64(new Uint8Array(64).fill(1)) });
		expect(call({ triggers: [forged, trigger(42, { tick: NOW_TICK - 1 })] }).fire).toBe(false);
	});

	/** A trigger for another matter cannot be replayed onto this one. */
	it('refuses a signature made over a different ref', () => {
		const k = kp(41);
		const wrongRef: Trigger = {
			keyIdHex: 'key41',
			publicKeyB64: b64(k.pub),
			sigB64: b64(sign(SIG_CONTEXT.legalTrigger, triggerMessage('b'.repeat(64), EPOCH), k.priv)),
			tick: NOW_TICK
		};
		expect(call({ triggers: [wrongRef, trigger(42, { tick: NOW_TICK - 1 })] }).fire).toBe(false);
	});

	/** Nor from an earlier detention of the same person. */
	it('refuses a signature made over a different epoch', () => {
		const k = kp(41);
		const wrongEpoch: Trigger = {
			keyIdHex: 'key41',
			publicKeyB64: b64(k.pub),
			sigB64: b64(sign(SIG_CONTEXT.legalTrigger, triggerMessage(REF, EPOCH - 1), k.priv)),
			tick: NOW_TICK
		};
		expect(call({ triggers: [wrongEpoch, trigger(42, { tick: NOW_TICK - 1 })] }).fire).toBe(false);
	});

	/**
	 * CROSS-PROTOCOL CONFUSION. A legal-compartment key signs more than one thing,
	 * so a signature made for the broker context must not count as a trigger.
	 */
	it('refuses a signature made under a different context tag', () => {
		const k = kp(41);
		const crossed: Trigger = {
			keyIdHex: 'key41',
			publicKeyB64: b64(k.pub),
			sigB64: b64(sign(SIG_CONTEXT.legalBroker, triggerMessage(REF, EPOCH), k.priv)),
			tick: NOW_TICK
		};
		expect(call({ triggers: [crossed, trigger(42, { tick: NOW_TICK - 1 })] }).fire).toBe(false);
	});

	it('refuses malformed base64 without throwing', () => {
		const bad = trigger(41, { sigB64: '!!!not base64!!!', publicKeyB64: '###' });
		expect(() => call({ triggers: [bad, trigger(42, { tick: NOW_TICK - 1 })] })).not.toThrow();
		expect(call({ triggers: [bad, trigger(42, { tick: NOW_TICK - 1 })] }).fire).toBe(false);
	});
});

describe('triggers describe the situation now', () => {
	const windowTicks = Math.ceil(TRIGGER_WINDOW_MS / TRIGGER_TICK_MS);

	/** A trigger from hours ago is not evidence anyone is being held now. */
	it('ignores a trigger older than the window', () => {
		const stale = trigger(42, { tick: NOW_TICK - windowTicks - 1 });
		expect(call({ triggers: [trigger(41), stale] })).toEqual({
			fire: false,
			reason: 'not-enough-triggers'
		});
	});

	it('accepts a trigger at the edge of the window', () => {
		const edge = trigger(42, { tick: NOW_TICK - windowTicks });
		expect(call({ triggers: [trigger(41), edge] })).toEqual({ fire: true });
	});

	/** A tick from the future is a client clock, not evidence. */
	it('ignores a trigger dated in the future', () => {
		const future = trigger(42, { tick: NOW_TICK + 5 });
		expect(call({ triggers: [trigger(41), future] }).fire).toBe(false);
	});

	it('ignores a non-integer tick', () => {
		expect(call({ triggers: [trigger(41), trigger(42, { tick: 1.5 })] }).fire).toBe(false);
	});
});

describe('the broker quorum is the second, independent bar', () => {
	/**
	 * THE RESTING STATE. key_directory ships empty, so this refuses today however
	 * many lawyers act. Two independent unsatisfiable conditions, not one.
	 */
	it('refuses with an empty directory even when both triggers are valid', () => {
		expect(call({ directory: [] })).toEqual({ fire: false, reason: 'no-broker-quorum' });
	});

	it('refuses with no broker signature', () => {
		expect(call({ brokerSignatures: [] })).toEqual({ fire: false, reason: 'no-broker-quorum' });
	});

	/** The n floor: a directory of one broker key is not a directory. */
	it('refuses when the directory holds fewer than three eligible broker keys', () => {
		expect(BROKER_MIN_KEYS).toBeGreaterThanOrEqual(3);
		expect(BROKER_REQUIRED).toBe(1);
		expect(call({ directory: [brokerEntry('b1', 51), brokerEntry('b2', 52)] }).fire).toBe(false);
	});

	it('refuses a broker key bound to another role', () => {
		const wrongRole = [
			brokerEntry('b1', 51, 'marshal'),
			brokerEntry('b2', 52, 'marshal'),
			brokerEntry('b3', 53, 'marshal')
		];
		expect(call({ directory: wrongRole }).fire).toBe(false);
	});

	it('refuses a revoked broker key', () => {
		expect(call({ revocations: [{ key_id: 'b1', revoked_at_epoch: EPOCH }] }).fire).toBe(false);
	});

	/**
	 * ORDER MATTERS FOR THE REASON, NOT THE OUTCOME: the trigger checks run first, so
	 * a caller who has not met them learns that rather than learning about the
	 * broker directory, which is not their business.
	 */
	it('reports the trigger failure when both bars are unmet', () => {
		expect(call({ triggers: [trigger(41)], directory: [] })).toEqual({
			fire: false,
			reason: 'not-enough-triggers'
		});
	});
});

describe('what goes on the wire carries nothing', () => {
	/**
	 * Queue messages are retained for days and a DLQ holds them longer, so
	 * "incommunicado in IN-PB-LDH at 14:05" sitting in a dead-letter queue is a
	 * protest-intensity signal tied to a place and an hour.
	 */
	it('emits exactly a kind and an opaque ref', () => {
		const e = incommunicadoEvent(REF);
		expect(Object.keys(e).sort()).toEqual(['kind', 'ref_hash']);
		expect(JSON.stringify(e)).not.toMatch(/region|station|lawyer|name|time|at|charge|detainee/i);
	});
});
