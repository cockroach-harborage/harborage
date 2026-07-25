/**
 * Browser key custody (§5.1). NOT in the barrel: it reaches WebCrypto through
 * `globalThis.crypto`, so importing it from a Workers-typed package fails
 * typecheck. Import the `./device-keys` subpath from the browser only.
 *
 * The shape of the design:
 *
 *   BIP39 seed (64B) ──importKey('raw', …, 'HKDF', extractable=false)──► root
 *          │                                                              │
 *          └── zeroed immediately                            deriveBits(salt, info)
 *                                                                         │
 *                                                          compartment seed (32B)
 *                                                                         │
 *                                     importKey(pkcs8/jwk, …, extractable=false)
 *                                                                         │
 *                                                        Ed25519 / X25519 CryptoKey
 *
 * The root is held as a non-extractable HKDF CryptoKey rather than as bytes, so
 * after creation no code path — ours or injected — can read the seed back out
 * of storage, while per-request derivation (§5.1) still works. Verified against
 * the noble path: WebCrypto HKDF does Extract-then-Expand in one call, so
 * deriveBits(salt='harborage/v1', info='compartment/<d>/<e>') is byte-identical
 * to compartmentSeed(rootKeyFromSeed(seed), d, e), and WebCrypto Ed25519
 * signatures are byte-identical to noble's. Both are asserted in the tests, so
 * the ladder below cannot silently diverge between tiers.
 *
 * HONEST LIMIT (ARCHITECTURE §9.7): non-extractable is not hardware-backed.
 * IndexedDB is not encrypted at rest, and a seized, unlocked device is
 * compromised — the key can still be USED by anything running in the origin.
 * What this buys is that the key material cannot be copied off the device or
 * exfiltrated by injected script. That is worth having and is not the same as
 * safety. The APK is the real fix.
 */
import { ed25519 } from '@noble/curves/ed25519.js';
import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';
import {
	domainSeparate,
	SIGNING_ALG,
	type SigContext,
	type SigningAlgId
} from './compartments.ts';

/**
 * Which custody the device can actually give us.
 * - `secure-curve`  Ed25519 + X25519, non-extractable. Preferred.
 * - `p256`          ECDSA/ECDH P-256, non-extractable. Universal for a decade.
 * - `memory-only`   No usable WebCrypto. Nothing is persisted and nothing is
 *                   signed: read-only, per §5.1. Surfaced to the user in plain
 *                   words rather than degraded silently.
 */
export type CustodyTier = 'secure-curve' | 'p256' | 'memory-only';

export interface DeviceSigningKey {
	algId: SigningAlgId;
	/** Raw Ed25519 (32B) or compressed P-256 point (33B). Safe to publish. */
	publicKey: Uint8Array;
	privateKey: CryptoKey;
}

export interface DeviceBoxKey {
	publicKey: Uint8Array;
	privateKey: CryptoKey;
}

const HKDF_SALT = new TextEncoder().encode('harborage/v1');

// RFC 8410 PKCS#8 prefixes for a bare 32-byte private key.
// SEQUENCE { INTEGER 0, SEQUENCE { OID }, OCTET STRING { OCTET STRING (32) } }
const PKCS8_ED25519 = Uint8Array.from([
	0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20
]);
const PKCS8_X25519 = Uint8Array.from([
	0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20
]);

function subtle(): SubtleCrypto {
	const c = globalThis.crypto?.subtle;
	if (!c) throw new Error('WebCrypto unavailable');
	return c;
}

function pkcs8(prefix: Uint8Array, seed32: Uint8Array): Uint8Array {
	const out = new Uint8Array(prefix.length + seed32.length);
	out.set(prefix);
	out.set(seed32, prefix.length);
	return out;
}

/**
 * Overwrite key material we are done with. Best-effort by nature: a JS engine
 * may have copied the buffer during GC, and we cannot reach those copies. It
 * still shortens the window, and skipping it would be worse.
 */
export function zero(bytes: Uint8Array): void {
	bytes.fill(0);
}

function b64u(bytes: Uint8Array): string {
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/**
 * Map a 32-byte seed into a valid P-256 scalar (1 ≤ d < n). The modulo has a
 * bias of roughly 2^-128 for a uniform 256-bit input against this order, which
 * is far below anything reachable; rejection sampling would need a retry loop
 * for no measurable gain.
 */
function p256Scalar(seed32: Uint8Array): Uint8Array {
	let n = 0n;
	for (const b of seed32) n = (n << 8n) | BigInt(b);
	const order = p256.Point.Fn.ORDER;
	const d = (n % (order - 1n)) + 1n;
	const out = new Uint8Array(32);
	let v = d;
	for (let i = 31; i >= 0; i--) {
		out[i] = Number(v & 0xffn);
		v >>= 8n;
	}
	return out;
}

/**
 * What this device can do, decided by actually importing AND using a key.
 * Feature-detecting on `importKey` alone is not enough: a browser can accept an
 * Ed25519 import and then fail to sign with it, and finding that out at the
 * moment a user sends something is the worst possible time.
 */
export async function detectCustodyTier(): Promise<CustodyTier> {
	const probe = new Uint8Array(32).fill(1);
	const message = new TextEncoder().encode('harborage/probe');
	try {
		const key = await subtle().importKey(
			'pkcs8',
			pkcs8(PKCS8_ED25519, probe) as BufferSource,
			{ name: 'Ed25519' },
			false,
			['sign']
		);
		await subtle().sign({ name: 'Ed25519' }, key, message as BufferSource);
		return 'secure-curve';
	} catch {
		// fall through
	}
	try {
		const key = await importP256(probe, 'ECDSA', ['sign']);
		await subtle().sign({ name: 'ECDSA', hash: 'SHA-256' }, key, message as BufferSource);
		return 'p256';
	} catch {
		return 'memory-only';
	}
}

async function importP256(
	seed32: Uint8Array,
	name: 'ECDSA' | 'ECDH',
	usages: KeyUsage[]
): Promise<CryptoKey> {
	const d = p256Scalar(seed32);
	const uncompressed = p256.getPublicKey(d, false); // 0x04 ‖ X(32) ‖ Y(32)
	const jwk: JsonWebKey = {
		kty: 'EC',
		crv: 'P-256',
		d: b64u(d),
		x: b64u(uncompressed.slice(1, 33)),
		y: b64u(uncompressed.slice(33, 65)),
		ext: false,
		key_ops: usages
	};
	try {
		return await subtle().importKey('jwk', jwk, { name, namedCurve: 'P-256' }, false, usages);
	} finally {
		zero(d);
	}
}

/**
 * Import the BIP39 seed as the non-extractable HKDF root. HKDF keys must be
 * imported non-extractable per the WebCrypto spec, which is exactly what we
 * want here. The caller zeroes `seed64` afterwards.
 */
export async function importRootKey(seed64: Uint8Array): Promise<CryptoKey> {
	return subtle().importKey('raw', seed64 as BufferSource, 'HKDF', false, ['deriveBits']);
}

/** Byte-identical to compartmentSeed(rootKeyFromSeed(seed), domain, epoch). */
export async function deriveCompartmentSeed(
	root: CryptoKey,
	domain: string,
	epoch: number
): Promise<Uint8Array> {
	const info = new TextEncoder().encode(`compartment/${domain}/${epoch}`);
	const bits = await subtle().deriveBits(
		{ name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT as BufferSource, info: info as BufferSource },
		root,
		256
	);
	return new Uint8Array(bits);
}

/** Byte-identical to requestSeed(rootKeyFromSeed(seed), domain, epoch, nonce). */
export async function deriveRequestSeed(
	root: CryptoKey,
	domain: string,
	epoch: number,
	nonce: Uint8Array
): Promise<Uint8Array> {
	const prefix = new TextEncoder().encode(`request/${domain}/${epoch}/`);
	const info = new Uint8Array(prefix.length + nonce.length);
	info.set(prefix);
	info.set(nonce, prefix.length);
	const bits = await subtle().deriveBits(
		{ name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT as BufferSource, info: info as BufferSource },
		root,
		256
	);
	return new Uint8Array(bits);
}

export async function importSigningKey(
	seed32: Uint8Array,
	tier: CustodyTier
): Promise<DeviceSigningKey> {
	if (tier === 'secure-curve') {
		const privateKey = await subtle().importKey(
			'pkcs8',
			pkcs8(PKCS8_ED25519, seed32) as BufferSource,
			{ name: 'Ed25519' },
			false,
			['sign']
		);
		return { algId: SIGNING_ALG.ed25519, publicKey: ed25519.getPublicKey(seed32), privateKey };
	}
	if (tier === 'p256') {
		const privateKey = await importP256(seed32, 'ECDSA', ['sign']);
		const d = p256Scalar(seed32);
		try {
			return { algId: SIGNING_ALG.ecdsaP256, publicKey: p256.getPublicKey(d, true), privateKey };
		} finally {
			zero(d);
		}
	}
	throw new Error('this device cannot hold a signing key');
}

export async function importBoxKey(
	seed32: Uint8Array,
	tier: CustodyTier
): Promise<DeviceBoxKey> {
	if (tier === 'secure-curve') {
		const privateKey = await subtle().importKey(
			'pkcs8',
			pkcs8(PKCS8_X25519, seed32) as BufferSource,
			{ name: 'X25519' },
			false,
			['deriveBits']
		);
		const { x25519 } = await import('@noble/curves/ed25519.js');
		return { publicKey: x25519.getPublicKey(seed32), privateKey };
	}
	if (tier === 'p256') {
		const privateKey = await importP256(seed32, 'ECDH', ['deriveBits']);
		const d = p256Scalar(seed32);
		try {
			return { publicKey: p256.getPublicKey(d, true), privateKey };
		} finally {
			zero(d);
		}
	}
	throw new Error('this device cannot hold a key-agreement key');
}

/**
 * Sign under a domain-separation context, same framing as the noble path in
 * hkdf-tree.ts. ECDSA is prehashed with SHA-256 by WebCrypto; Ed25519 hashes
 * internally. Both emit a fixed 64-byte signature.
 */
function webCryptoAlg(algId: SigningAlgId): AlgorithmIdentifier | EcdsaParams {
	return algId === SIGNING_ALG.ed25519
		? { name: 'Ed25519' }
		: { name: 'ECDSA', hash: 'SHA-256' };
}

export async function signWithDeviceKey(
	signingKey: DeviceSigningKey,
	context: SigContext,
	message: Uint8Array
): Promise<Uint8Array> {
	const framed = domainSeparate(context, message);
	const sig = await subtle().sign(
		webCryptoAlg(signingKey.algId),
		signingKey.privateKey,
		framed as BufferSource
	);
	return new Uint8Array(sig);
}

/**
 * Verify a device signature. Re-exported from signature.ts so the browser and
 * the Worker verify through exactly one implementation; the Worker cannot
 * import this file, because the WebCrypto reach above fails Workers typecheck.
 */
export { verifyContextSignature as verifyDeviceSignature } from './signature.ts';
