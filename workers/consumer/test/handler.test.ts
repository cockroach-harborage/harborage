/**
 * The ack rule, tested.
 *
 * Cloudflare Queues acks an entire batch on a bare return, so the failure mode
 * this file guards is silent: a protestor's report vanishing with no error
 * anywhere. Every test here asserts an EXPLICIT disposition, and several assert
 * that a message was NOT acked, which is the direction that loses data.
 */
import { describe, expect, it, vi } from 'vitest';
import { frameEnvelope, ALG_SEALED_BOX_X25519 } from '@harborage/worker-lib/envelope';
import { NONCE_LENGTH, openSealedBox, sealTo, sealedBoxPublicKey } from '@harborage/crypto/sealed-box';
import {
	handleBatch,
	handleKeyring,
	handleRegister,
	type HandlerDeps,
	type Outcome,
	type RecordedKeyring,
	type RegisterBody
} from '../src/handler.ts';
import { ALG_VAULT_KEYRING } from '@harborage/worker-lib/envelope';
import { decodeKeyring, encodeKeyring, wrapTierA, type HolderKey } from '@harborage/crypto/vault-key';
import { compileRuleset } from '../src/tier0.ts';

const INTAKE_SK = new Uint8Array(32).fill(11);
const INTAKE_SK_HEX = Array.from(INTAKE_SK, (b) => b.toString(16).padStart(2, '0')).join('');
const INTAKE_PK = sealedBoxPublicKey(INTAKE_SK);

const META = {
	type: 'teargas',
	note: 'Gas near the north gate this afternoon.',
	area: 'North gate',
	occurred_date: '2026-07-25',
	redaction_confirmed: true
};

function envelope(meta: unknown = META): Uint8Array {
	const seed = new Uint8Array(32);
	const nonce = new Uint8Array(NONCE_LENGTH);
	crypto.getRandomValues(seed);
	crypto.getRandomValues(nonce);
	return frameEnvelope(
		sealTo(INTAKE_PK, new TextEncoder().encode(JSON.stringify(meta)), seed, nonce),
		ALG_SEALED_BOX_X25519
	);
}

function deps(over: Partial<HandlerDeps> = {}): HandlerDeps {
	return {
		rulesets: { get: async () => null },
		intakePrivateKey: INTAKE_SK_HEX,
		recordIncident: vi.fn(async () => {}),
		recordKeyring: vi.fn(async () => {}),
		applyVerification: vi.fn(async () => {}),
		now: () => 1_760_000_000_000,
		...over
	};
}

const NO_RULES = compileRuleset({});

function message(body: unknown) {
	return { body, ack: vi.fn(), retry: vi.fn() };
}

describe('a well-formed report is recorded and acked', () => {
	it('opens the envelope, records the incident, and acks', async () => {
		const d = deps();
		const outcome = await handleRegister(
			{ kind: 'incident_register', envelope: envelope() } as RegisterBody,
			NO_RULES,
			d
		);
		expect(outcome.disposition).toBe('ack');
		expect(d.recordIncident).toHaveBeenCalledTimes(1);
		expect(d.applyVerification).toHaveBeenCalledTimes(1);

		const recorded = (d.recordIncident as ReturnType<typeof vi.fn>).mock.calls[0]![0];
		expect(recorded.type).toBe('teargas');
		expect(recorded.narrative).toContain('north gate');
	});

	it('starts every incident at Unverified with no reach', async () => {
		const d = deps();
		await handleRegister(
			{ kind: 'incident_register', envelope: envelope() } as RegisterBody,
			NO_RULES,
			d
		);
		const obs = (d.applyVerification as ReturnType<typeof vi.fn>).mock.calls[0]![1];
		expect(obs.independentCorroborators).toBe(0);
		// Tier-0 is ONE signal. It can never supply the second one the machine
		// needs before it will hide anything.
		expect(obs.secondIndependentRisk).toBe(false);
	});
});

describe('nothing is acked away', () => {
	const cases: Array<[string, Partial<HandlerDeps>, RegisterBody, string]> = [
		[
			'the intake key is not set yet',
			{ intakePrivateKey: undefined },
			{ kind: 'incident_register', envelope: envelope() },
			'intake_key_absent'
		],
		[
			'the intake key is malformed',
			{ intakePrivateKey: 'nonsense' },
			{ kind: 'incident_register', envelope: envelope() },
			'intake_key_malformed'
		],
		[
			'the envelope is missing',
			{},
			{ kind: 'incident_register' },
			'envelope_missing'
		],
		[
			'the envelope is malformed',
			{},
			{ kind: 'incident_register', envelope: new Uint8Array(10) },
			'envelope_malformed'
		],
		[
			'storage failed',
			{
				recordIncident: async () => {
					throw new Error('d1 down');
				}
			},
			{ kind: 'incident_register', envelope: envelope() },
			'storage_failed'
		]
	];

	for (const [why, over, body, reason] of cases) {
		it(`retries rather than acking when ${why}`, async () => {
			const outcome = await handleRegister(body, NO_RULES, deps(over));
			expect(outcome.disposition).toBe('retry');
			expect(outcome.reason).toBe(reason);
		});
	}

	// A body sealed to a different key will never open. Acking would discard a
	// report silently; retrying sends it to the DLQ where it is preserved and
	// can be looked at.
	it('sends a permanently unopenable body to the DLQ rather than dropping it', async () => {
		const other = sealedBoxPublicKey(new Uint8Array(32).fill(7));
		const seed = new Uint8Array(32);
		const nonce = new Uint8Array(NONCE_LENGTH);
		crypto.getRandomValues(seed);
		crypto.getRandomValues(nonce);
		const wrong = frameEnvelope(
			sealTo(other, new TextEncoder().encode('{}'), seed, nonce),
			ALG_SEALED_BOX_X25519
		);
		const outcome = await handleRegister(
			{ kind: 'incident_register', envelope: wrong },
			NO_RULES,
			deps()
		);
		expect(outcome.disposition).toBe('retry');
		expect(outcome.reason).toBe('envelope_unopenable');
	});

	it('retries an unopenable-because-not-JSON body', async () => {
		const seed = new Uint8Array(32);
		const nonce = new Uint8Array(NONCE_LENGTH);
		crypto.getRandomValues(seed);
		crypto.getRandomValues(nonce);
		const notJson = frameEnvelope(
			sealTo(INTAKE_PK, new TextEncoder().encode('not json at all'), seed, nonce),
			ALG_SEALED_BOX_X25519
		);
		const outcome = await handleRegister(
			{ kind: 'incident_register', envelope: notJson },
			NO_RULES,
			deps()
		);
		expect(outcome.disposition).toBe('retry');
		expect(outcome.reason).toBe('metadata_not_json');
	});
});

describe('the batch loop disposes of every message explicitly', () => {
	it('acks and retries the right ones, and never leaves one untouched', async () => {
		const good = message({ kind: 'incident_register', envelope: envelope() });
		const poison = message({ kind: 'incident_register', envelope: new Uint8Array(3) });
		const unknown = message({ kind: 'something_else' });
		const report = message({ kind: 'directory_report', entity_id: 'x', reason_code: 'y' });

		const outcomes = await handleBatch(
			{ messages: [good, poison, unknown, report] } as never,
			deps()
		);

		expect(outcomes.map((o: Outcome) => o.disposition)).toEqual([
			'ack',
			'retry',
			'retry',
			'ack'
		]);
		// The important assertion: every message got exactly one disposition.
		for (const m of [good, poison, unknown, report]) {
			expect(m.ack.mock.calls.length + m.retry.mock.calls.length).toBe(1);
		}
		expect(good.ack).toHaveBeenCalled();
		expect(poison.retry).toHaveBeenCalled();
		expect(unknown.retry).toHaveBeenCalled();
	});

	// One bad message must not decide the fate of its neighbours, and a throw
	// must never escape into the batch-level implicit ack.
	it('contains a throwing handler to its own message', async () => {
		const first = message({ kind: 'incident_register', envelope: envelope() });
		const second = message({ kind: 'incident_register', envelope: envelope() });
		let calls = 0;
		const outcomes = await handleBatch({ messages: [first, second] } as never, {
			...deps(),
			recordIncident: async () => {
				calls++;
				if (calls === 1) throw new Error('boom');
			}
		});
		expect(outcomes[0]!.disposition).toBe('retry');
		expect(outcomes[1]!.disposition).toBe('ack');
		expect(first.retry).toHaveBeenCalled();
		expect(second.ack).toHaveBeenCalled();
	});

	it('handles an empty batch without incident', async () => {
		expect(await handleBatch({ messages: [] } as never, deps())).toEqual([]);
	});

	// A ruleset that cannot be loaded must not stop the batch: see EMPTY_RULESET
	// for why fail-open is the safe direction for a screen.
	it('still processes messages when the ruleset cannot be loaded', async () => {
		const good = message({ kind: 'incident_register', envelope: envelope() });
		const outcomes = await handleBatch({ messages: [good] } as never, {
			...deps(),
			rulesets: {
				get: async () => {
					throw new Error('kv down');
				}
			}
		});
		expect(outcomes[0]!.disposition).toBe('ack');
	});
});

// --- Evidence keyrings: stored opaque, never opened --------------------------

const REPORTER_SK = new Uint8Array(32).fill(7);
const CUSTODIAN_SK = new Uint8Array(32).fill(13);
const reporterKey: HolderKey = { holder: 'reporter', publicKey: sealedBoxPublicKey(REPORTER_SK) };
const custodianKey: HolderKey = {
	holder: 'custodian-offshore',
	publicKey: sealedBoxPublicKey(CUSTODIAN_SK)
};

function keyringEnvelope(): Uint8Array {
	const ring = wrapTierA(
		new Uint8Array(32).fill(0x5a),
		new Uint8Array(32).fill(0x11),
		reporterKey,
		(n) => {
			const out = new Uint8Array(n);
			crypto.getRandomValues(out);
			return out;
		},
		[custodianKey]
	);
	return frameEnvelope(encodeKeyring(ring), ALG_VAULT_KEYRING);
}

describe('evidence keyrings', () => {
	it('stores the blob verbatim, without opening it', async () => {
		const seen: RecordedKeyring[] = [];
		const recordKeyring = vi.fn(async (input: RecordedKeyring) => {
			seen.push(input);
		});
		const framed = keyringEnvelope();
		const outcome = await handleKeyring({ envelope: framed }, deps({ recordKeyring }));

		expect(outcome).toEqual({ disposition: 'ack', reason: 'keyring_stored' });
		expect(recordKeyring).toHaveBeenCalledTimes(1);
		const stored = seen[0]!;
		expect(stored.tier).toBe('A');
		expect(stored.copyCount).toBe(2);
		expect(stored.originalSha256).toBe('11'.repeat(32));
		// Verbatim: the bytes stored are the bytes that arrived, minus the frame.
		expect(stored.keyring).toEqual(framed.subarray(5));
	});

	/**
	 * The custody claim, as a test. The consumer holds INTAKE_PRIVATE_KEY, and if
	 * that key could open a keyring copy then POST /api/evidence/keyring would be
	 * SEALED-E2E in name only. It cannot: the copies are sealed to holder keys
	 * that exist nowhere on this platform.
	 */
	it('cannot open a keyring copy with the key this worker does hold', async () => {
		const framed = keyringEnvelope();
		const ring = decodeKeyring(framed.subarray(5))!;
		for (const copy of ring.copies) {
			expect(openSealedBox(INTAKE_SK, copy.sealed)).toBeNull();
		}
		// And the holders it was actually sealed to can open it, so the test is
		// checking custody rather than a broken ciphertext.
		expect(openSealedBox(REPORTER_SK, ring.copies[0]!.sealed)).not.toBeNull();
		expect(openSealedBox(CUSTODIAN_SK, ring.copies[1]!.sealed)).not.toBeNull();
	});

	it('sends an undecodable keyring to the DLQ rather than acking it away', async () => {
		const outcome = await handleKeyring(
			{ envelope: frameEnvelope(new Uint8Array(200).fill(9), ALG_VAULT_KEYRING) },
			deps()
		);
		expect(outcome.disposition).toBe('retry');
		expect(outcome.reason).toBe('keyring_undecodable');
	});

	it('retries rather than acks when storage fails', async () => {
		const outcome = await handleKeyring(
			{ envelope: keyringEnvelope() },
			deps({
				recordKeyring: vi.fn(async () => {
					throw new Error('d1 down');
				})
			})
		);
		expect(outcome).toEqual({ disposition: 'retry', reason: 'keyring_store_failed' });
	});

	it('routes the queue kind to the keyring handler', async () => {
		const recordKeyring = vi.fn(async () => {});
		const msg = message({ kind: 'evidence_keyring', envelope: keyringEnvelope() });
		const outcomes = await handleBatch({ messages: [msg] } as never, deps({ recordKeyring }));
		expect(outcomes[0]!.reason).toBe('keyring_stored');
		expect(msg.ack).toHaveBeenCalledTimes(1);
		expect(msg.retry).not.toHaveBeenCalled();
	});
});
