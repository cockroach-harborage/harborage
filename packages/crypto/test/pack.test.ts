import { describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { blake2b } from '@noble/hashes/blake2.js';
import { base64 } from '@scure/base';
import { canonicalJson, parsePack, verifyPackManifest, verifyPack } from '../src/pack.ts';

// ---- TEST-ONLY minisign signer. Production signing is offline, never in code.
// This exists solely to exercise the verify path with a known keypair.
const DEV_SEED = new Uint8Array(32).fill(7);
const OTHER_SEED = new Uint8Array(32).fill(9);
const DEV_KEY_ID = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const enc = (s: string) => new TextEncoder().encode(s);

function publicKeyLine(seed = DEV_SEED, keyId = DEV_KEY_ID): string {
	const raw = new Uint8Array(42);
	raw.set(enc('Ed'), 0);
	raw.set(keyId, 2);
	raw.set(ed25519.getPublicKey(seed), 10);
	return 'untrusted comment: dev\n' + base64.encode(raw);
}

function sign(
	message: Uint8Array,
	opts: { seed?: Uint8Array; keyId?: Uint8Array; prehash?: boolean; trustedComment?: string } = {}
): string {
	const { seed = DEV_SEED, keyId = DEV_KEY_ID, prehash = false, trustedComment = 'test' } = opts;
	const signed = prehash ? blake2b(message, { dkLen: 64 }) : message;
	const sig = ed25519.sign(signed, seed);
	const raw = new Uint8Array(74);
	raw.set(enc(prehash ? 'ED' : 'Ed'), 0);
	raw.set(keyId, 2);
	raw.set(sig, 10);
	const global = ed25519.sign(new Uint8Array([...sig, ...enc(trustedComment)]), seed);
	return [
		'untrusted comment: dev sig',
		base64.encode(raw),
		'trusted comment: ' + trustedComment,
		base64.encode(global)
	].join('\n');
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

function buildPack(name: string, epoch: number, files: Record<string, unknown>): Uint8Array {
	const manifest: Record<string, string> = {};
	for (const [p, content] of Object.entries(files))
		manifest[p] = hex(sha256(enc(canonicalJson(content))));
	return enc(canonicalJson({ format: 'harborage-pack/v1', name, epoch, manifest, files }));
}

const SAMPLE = { 'a/x.json': { hello: 'world', n: [3, 1, 2] } };

describe('canonicalJson', () => {
	it('sorts keys, preserves array order, is compact', () => {
		expect(canonicalJson({ b: 1, a: [2, 1] })).toBe('{"a":[2,1],"b":1}');
	});
});

describe('pack sign + verify (both prehash modes)', () => {
	for (const prehash of [false, true]) {
		it(`round-trips a signed pack (${prehash ? 'ED prehash' : 'Ed pure'})`, () => {
			const bytes = buildPack('sample', 1, SAMPLE);
			const sig = sign(bytes, { prehash });
			expect(verifyPack(bytes, sig, [publicKeyLine()])).toBe(true);
		});
	}

	it('accepts a self-consistent manifest', () => {
		const pack = parsePack(buildPack('sample', 1, SAMPLE));
		expect(pack).not.toBeNull();
		expect(verifyPackManifest(pack!)).toBe(true);
	});

	it('rejects a tampered pack byte (signature fails)', () => {
		const bytes = buildPack('sample', 1, SAMPLE);
		const sig = sign(bytes);
		const tampered = bytes.slice();
		const i = tampered.length - 3;
		tampered[i] = (tampered[i] ?? 0) ^ 0x01;
		expect(verifyPack(tampered, sig, [publicKeyLine()])).toBe(false);
	});

	it('rejects a manifest that does not match its files', () => {
		const pack = parsePack(buildPack('sample', 1, SAMPLE))!;
		pack.files['a/x.json'] = { hello: 'evil' }; // content changed, manifest stale
		expect(verifyPackManifest(pack)).toBe(false);
	});

	it('rejects a valid signature from a non-pinned key', () => {
		const bytes = buildPack('sample', 1, SAMPLE);
		const sig = sign(bytes, { seed: OTHER_SEED });
		expect(verifyPack(bytes, sig, [publicKeyLine()])).toBe(false); // pinned = DEV, signed = OTHER
	});

	it('fails closed with no pinned keys or no signature', () => {
		const bytes = buildPack('sample', 1, SAMPLE);
		expect(verifyPack(bytes, sign(bytes), [])).toBe(false);
		expect(verifyPack(bytes, '', [publicKeyLine()])).toBe(false);
	});
});
