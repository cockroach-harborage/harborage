import { describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { blake2b } from '@noble/hashes/blake2.js';
import { base64 } from '@scure/base';
import {
	boxKeypair,
	combineShares,
	compartmentSeed,
	isValidMnemonic,
	mnemonicToRootSeed,
	newContentKey,
	newMnemonic,
	open,
	parsePublicKey,
	requestSeed,
	rootKeyFromSeed,
	seal,
	sharedSecret,
	sign,
	signingKeypair,
	splitSecret,
	verify,
	verifyMinisign
} from '../src/index.ts';

const enc = new TextEncoder();

describe('mnemonic identity', () => {
	it('generates a valid 12-word mnemonic', () => {
		const m = newMnemonic();
		expect(m.split(' ')).toHaveLength(12);
		expect(isValidMnemonic(m)).toBe(true);
	});

	it('rejects an invalid mnemonic instead of deriving from it', async () => {
		await expect(mnemonicToRootSeed('not a real mnemonic at all')).rejects.toThrow();
	});

	it('same mnemonic → same seed; passphrase selects a different (decoy) tree', async () => {
		const m = newMnemonic();
		const a = await mnemonicToRootSeed(m);
		const b = await mnemonicToRootSeed(m);
		const decoy = await mnemonicToRootSeed(m, 'duress');
		expect(a).toEqual(b);
		expect(a).not.toEqual(decoy);
	});
});

describe('HKDF compartment tree', () => {
	const seed = new Uint8Array(64).fill(7);
	const root = rootKeyFromSeed(seed);

	it('is deterministic per (domain, epoch) and distinct across compartments', () => {
		const med1 = compartmentSeed(root, 'medical', 1);
		const med1b = compartmentSeed(root, 'medical', 1);
		const legal1 = compartmentSeed(root, 'legal', 1);
		const med2 = compartmentSeed(root, 'medical', 2);
		expect(med1).toEqual(med1b);
		expect(med1).not.toEqual(legal1);
		expect(med1).not.toEqual(med2);
	});

	it('per-request nonce yields unlinkable one-shot seeds', () => {
		const a = requestSeed(root, 'medical', 1, enc.encode('nonce-a'));
		const b = requestSeed(root, 'medical', 1, enc.encode('nonce-b'));
		expect(a).not.toEqual(b);
	});

	it('signs and verifies with a derived Ed25519 key', () => {
		const kp = signingKeypair(compartmentSeed(root, 'posts', 1));
		const msg = enc.encode('hello');
		const sig = sign(msg, kp.secretKey);
		expect(verify(sig, msg, kp.publicKey)).toBe(true);
		expect(verify(sig, enc.encode('tampered'), kp.publicKey)).toBe(false);
	});

	it('X25519 both sides derive the same shared secret', () => {
		const a = boxKeypair(compartmentSeed(root, 'broker-a', 1));
		const b = boxKeypair(compartmentSeed(root, 'broker-b', 1));
		expect(sharedSecret(a.secretKey, b.publicKey)).toEqual(sharedSecret(b.secretKey, a.publicKey));
	});
});

describe('XChaCha20-Poly1305 seal', () => {
	it('round-trips and authenticates', () => {
		const key = newContentKey();
		const plaintext = enc.encode('sealed before submit');
		const envelope = seal(key, plaintext);
		expect(open(key, envelope)).toEqual(plaintext);
	});

	it('throws on tamper, wrong key, and AAD mismatch', () => {
		const key = newContentKey();
		const envelope = seal(key, enc.encode('x'), enc.encode('aad'));
		const tampered = envelope.slice();
		tampered[tampered.length - 1]! ^= 1;
		expect(() => open(key, tampered, enc.encode('aad'))).toThrow();
		expect(() => open(newContentKey(), envelope, enc.encode('aad'))).toThrow();
		expect(() => open(key, envelope, enc.encode('other'))).toThrow();
	});

	it('two seals of the same plaintext differ (fresh nonce)', () => {
		const key = newContentKey();
		const p = enc.encode('same');
		expect(seal(key, p)).not.toEqual(seal(key, p));
	});
});

describe('minisign verification', () => {
	// Build a signature file the way minisign/rsign2 does, signing with noble
	// directly — verify must accept it, and reject any tamper.
	function makeFixture(alg: 'Ed' | 'ED', message: Uint8Array) {
		const secret = new Uint8Array(32).fill(9);
		const pub = ed25519.getPublicKey(secret);
		const keyId = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
		const pkRaw = new Uint8Array(42);
		pkRaw.set(enc.encode('Ed'));
		pkRaw.set(keyId, 2);
		pkRaw.set(pub, 10);
		const pubFile = `untrusted comment: test key\n${base64.encode(pkRaw)}\n`;

		const signed = alg === 'ED' ? blake2b(message, { dkLen: 64 }) : message;
		const sig = ed25519.sign(signed, secret);
		const sigRaw = new Uint8Array(74);
		sigRaw.set(enc.encode(alg));
		sigRaw.set(keyId, 2);
		sigRaw.set(sig, 10);
		const trusted = 'timestamp:1234 file:pack.bin';
		const globalSig = ed25519.sign(
			new Uint8Array([...sig, ...enc.encode(trusted)]),
			secret
		);
		const sigFile = [
			'untrusted comment: signature from test key',
			base64.encode(sigRaw),
			`trusted comment: ${trusted}`,
			base64.encode(globalSig),
			''
		].join('\n');
		return { pubFile, sigFile };
	}

	const message = enc.encode('knowledge pack bytes');

	it('verifies pure (Ed) and prehashed (ED) signatures', () => {
		for (const alg of ['Ed', 'ED'] as const) {
			const { pubFile, sigFile } = makeFixture(alg, message);
			const result = verifyMinisign(parsePublicKey(pubFile), message, sigFile);
			expect(result.valid).toBe(true);
			expect(result.trustedComment).toBe('timestamp:1234 file:pack.bin');
		}
	});

	it('rejects a tampered message, wrong key id, and broken global signature', () => {
		const { pubFile, sigFile } = makeFixture('ED', message);
		const pub = parsePublicKey(pubFile);
		expect(verifyMinisign(pub, enc.encode('tampered'), sigFile).valid).toBe(false);
		const wrongId = { ...pub, keyId: new Uint8Array(8).fill(0xff) };
		expect(verifyMinisign(wrongId, message, sigFile).valid).toBe(false);
		const lines = sigFile.split('\n');
		lines[2] = 'trusted comment: rewritten';
		expect(verifyMinisign(pub, message, lines.join('\n')).valid).toBe(false);
	});
});

describe('Shamir secret sharing', () => {
	it('2-of-3: any two shares recover, thresholds are enforced', async () => {
		const secret = newContentKey();
		const shares = await splitSecret(secret, 3, 2);
		expect(shares).toHaveLength(3);
		const recovered = await combineShares([shares[2]!, shares[0]!]);
		expect(recovered).toEqual(secret);
		await expect(combineShares([shares[0]!])).rejects.toThrow();
		await expect(splitSecret(secret, 3, 5)).rejects.toThrow();
	});
});
