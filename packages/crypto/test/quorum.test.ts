import { describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { base64 } from '@scure/base';
import { verifyRoleQuorum, type RoleSignature } from '../src/quorum.ts';
import { domainSeparate, SIG_CONTEXT, type SigContext } from '../src/compartments.ts';
import type { KeyDirectoryEntry, RevocationEntry } from '../src/notice.ts';

const HASH = new Uint8Array(32).fill(7);
const OTHER_HASH = new Uint8Array(32).fill(9);
const EPOCH = 5;

function keypair(seed: number) {
	const priv = new Uint8Array(32).fill(seed);
	return { priv, pub: base64.encode(ed25519.getPublicKey(priv)) };
}

function entry(id: string, seed: number, role = 'marshal'): KeyDirectoryEntry {
	return {
		key_id: id,
		public_key: keypair(seed).pub,
		role,
		valid_from_epoch: 1,
		valid_to_epoch: null
	};
}

function sign(
	id: string,
	seed: number,
	hash = HASH,
	// Typed as SigContext, not inferred from the default: the inferred type is the
	// literal 'harborage/sig/marshal-signal/v1', which makes the cross-protocol
	// test below a type error. It still PASSED at runtime, which is the whole
	// reason both exit codes get read.
	tag: SigContext = SIG_CONTEXT.marshalSignal
): RoleSignature {
	return {
		key_id: id,
		sig: base64.encode(ed25519.sign(domainSeparate(tag, hash), keypair(seed).priv))
	};
}

function policy(over: Partial<Parameters<typeof verifyRoleQuorum>[0]> = {}) {
	return {
		contextTag: SIG_CONTEXT.marshalSignal,
		messageHash: HASH,
		signatures: [sign('m1', 1), sign('m2', 2)],
		directory: [entry('m1', 1), entry('m2', 2), entry('m3', 3)],
		revocations: [] as RevocationEntry[],
		requiredRole: 'marshal',
		required: 2,
		minDistinctKeys: 3,
		epoch: EPOCH,
		...over
	};
}

describe('the happy path', () => {
	it('accepts two of three distinct marshal keys', () => {
		const r = verifyRoleQuorum(policy());
		expect(r.valid).toBe(true);
		expect(r.validSigners.sort()).toEqual(['m1', 'm2']);
	});
});

describe('the n floor, which verifyNotice does not have', () => {
	/**
	 * §8.2's bar is "at least 2 of at least 3 DISTINCT keys". The second half is
	 * not expressible with a single m: a directory holding exactly two eligible
	 * keys satisfies 2-of-2 while satisfying nothing about the "of at least 3".
	 *
	 * Every other quorum test in this file seeds three or more keys and never
	 * exercises the floor, which is exactly how the gap survived in verifyNotice.
	 */
	it('refuses when the directory is too small, even with every key signing', () => {
		const r = verifyRoleQuorum(policy({ directory: [entry('m1', 1), entry('m2', 2)] }));
		expect(r.valid).toBe(false);
		expect(r.reason).toMatch(/eligible/);
	});

	/**
	 * The floor counts ELIGIBLE keys, not directory rows. A directory of fifty
	 * keys of which two are marshals is a two-marshal directory, and a naive
	 * `directory.length >= n` would call it satisfied.
	 */
	it('counts only keys bound to the required role', () => {
		const padded = [
			entry('m1', 1),
			entry('m2', 2),
			entry('n1', 4, 'official_notice'),
			entry('n2', 5, 'official_notice'),
			entry('n3', 6, 'official_notice')
		];
		expect(verifyRoleQuorum(policy({ directory: padded })).valid).toBe(false);
	});

	it('does not count a revoked key toward the floor', () => {
		const r = verifyRoleQuorum(
			policy({ revocations: [{ key_id: 'm3', revoked_at_epoch: 2 } as RevocationEntry] })
		);
		expect(r.valid).toBe(false);
	});

	it('does not count a key outside its validity window toward the floor', () => {
		const expired: KeyDirectoryEntry = { ...entry('m3', 3), valid_to_epoch: EPOCH - 1 };
		expect(
			verifyRoleQuorum(policy({ directory: [entry('m1', 1), entry('m2', 2), expired] })).valid
		).toBe(false);
	});
});

describe('domain separation, which verifyNotice also does not have', () => {
	/**
	 * verifyNotice verifies over the BARE payload hash, so a captured notice
	 * signature over hash H is byte-for-byte a valid signature over the same H in
	 * any other protocol that signs a bare hash. Only role binding stops a marshal
	 * signature being replayed as a naming signature today, and role binding is a
	 * POLICY invariant, not a cryptographic one.
	 */
	it('refuses a signature made for a different context over the same hash', () => {
		const crossProtocol = [
			sign('m1', 1, HASH, SIG_CONTEXT.namingRecord),
			sign('m2', 2, HASH, SIG_CONTEXT.namingRecord)
		];
		const r = verifyRoleQuorum(policy({ signatures: crossProtocol }));
		expect(r.valid).toBe(false);
	});

	it('refuses a signature over a different hash in the right context', () => {
		const wrongHash = [sign('m1', 1, OTHER_HASH), sign('m2', 2, OTHER_HASH)];
		expect(verifyRoleQuorum(policy({ signatures: wrongHash })).valid).toBe(false);
	});

	/**
	 * The positive control. Without it, "refuses everything" would be
	 * indistinguishable from a working verifier, and every refusal above would
	 * prove nothing about the mechanism.
	 */
	it('accepts the same hash signed under the right context', () => {
		expect(verifyRoleQuorum(policy({ contextTag: SIG_CONTEXT.marshalSignal })).valid).toBe(true);
	});
});

describe('distinctness', () => {
	/**
	 * Two signatures from one key is ONE key, and one key is one seized device.
	 * A test that only checks "0 fails, 2 passes" passes with a broken count.
	 */
	it('counts one key signing twice as one signer', () => {
		const twice = [sign('m1', 1), sign('m1', 1)];
		expect(verifyRoleQuorum(policy({ signatures: twice })).valid).toBe(false);
	});

	it('ignores a signature from a key that is not in the directory', () => {
		const stranger = [sign('m1', 1), sign('stranger', 9)];
		expect(verifyRoleQuorum(policy({ signatures: stranger })).valid).toBe(false);
	});

	it('ignores a revoked signer even when the floor is still met', () => {
		const dir = [entry('m1', 1), entry('m2', 2), entry('m3', 3), entry('m4', 4)];
		const r = verifyRoleQuorum(
			policy({
				directory: dir,
				revocations: [{ key_id: 'm2', revoked_at_epoch: 2 } as RevocationEntry]
			})
		);
		expect(r.valid).toBe(false);
		expect(r.validSigners).not.toContain('m2');
	});
});

describe('the resting state', () => {
	/**
	 * The key directory ships empty, so nothing verifies. Today no marshal signal
	 * and no naming record can be presented as authentic, whatever a flag says.
	 */
	it('refuses everything with an empty directory', () => {
		expect(verifyRoleQuorum(policy({ directory: [] })).valid).toBe(false);
	});

	it('never throws on malformed input', () => {
		const junk = [
			{ key_id: 'm1', sig: 'not base64 !!' },
			{ key_id: 'm2', sig: base64.encode(new Uint8Array(4)) }
		];
		expect(() => verifyRoleQuorum(policy({ signatures: junk }))).not.toThrow();
		expect(verifyRoleQuorum(policy({ signatures: junk })).valid).toBe(false);
	});
});
