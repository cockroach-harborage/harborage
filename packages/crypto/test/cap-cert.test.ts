import { describe, expect, it } from 'vitest';
import {
	CAP_MAGIC,
	CAP_VERSION,
	POP_LENGTH,
	POP_NONCE_LENGTH,
	capCertBody,
	capCertLength,
	capCertSelfSignatureValid,
	frameCapCert,
	framePop,
	isCapCert,
	isPop,
	popSignatureValid,
	popSigningBody,
	unframeCapCert,
	unframePop,
	type CapCertFields
} from '../src/cap-cert.ts';
import { SIGNING_ALG, SIG_CONTEXT } from '../src/compartments.ts';
import { sign, signingKeypair } from '../src/hkdf-tree.ts';
import { sha256 } from '@noble/hashes/sha2.js';

const SEED = new Uint8Array(32).fill(4);
const kp = signingKeypair(SEED);
const NOW = 1_760_000_000_000;

/** noUncheckedIndexedAccess makes a bare `buf[i] ^= x` an error. */
function flip(buf: Uint8Array, index: number, mask = 0xff): Uint8Array {
	buf[index] = (buf[index] ?? 0) ^ mask;
	return buf;
}


function fields(over: Partial<CapCertFields> = {}): CapCertFields {
	return {
		algId: SIGNING_ALG.ed25519,
		compartment: 'document',
		issuedAtMs: NOW,
		expiresAtMs: NOW + 3600_000,
		publicKey: kp.publicKey,
		...over
	};
}

function signedCert(over: Partial<CapCertFields> = {}): Uint8Array {
	const f = fields(over);
	return frameCapCert(f, sign(SIG_CONTEXT.capCert, capCertBody(f), SEED));
}

describe('cap-cert framing', () => {
	it('round-trips every field', () => {
		const cert = unframeCapCert(signedCert());
		expect(cert).not.toBeNull();
		expect(cert!.algId).toBe(SIGNING_ALG.ed25519);
		expect(cert!.compartment).toBe('document');
		expect(cert!.issuedAtMs).toBe(NOW);
		expect(cert!.expiresAtMs).toBe(NOW + 3600_000);
		expect(cert!.publicKey).toEqual(kp.publicKey);
		expect(cert!.bytes.length).toBe(capCertLength(SIGNING_ALG.ed25519));
	});

	it('accepts a well-formed certificate and its self-signature', () => {
		const cert = unframeCapCert(signedCert())!;
		expect(capCertSelfSignatureValid(cert)).toBe(true);
	});

	it('rejects the wrong magic, wrong version and truncation', () => {
		const good = signedCert();
		const badMagic = good.slice();
		badMagic[0] = 0x58;
		expect(isCapCert(badMagic)).toBe(false);

		const badVersion = good.slice();
		badVersion[CAP_MAGIC.length] = CAP_VERSION + 1;
		expect(isCapCert(badVersion)).toBe(false);

		expect(isCapCert(good.slice(0, good.length - 1))).toBe(false);
		expect(isCapCert(new Uint8Array(0))).toBe(false);
	});

	it('rejects an unknown algorithm id and an unknown compartment ordinal', () => {
		const badAlg = signedCert();
		badAlg[CAP_MAGIC.length + 1] = 99;
		expect(isCapCert(badAlg)).toBe(false);
		expect(unframeCapCert(badAlg)).toBeNull();

		const badCompartment = signedCert();
		badCompartment[CAP_MAGIC.length + 2] = 200;
		expect(isCapCert(badCompartment)).toBe(false);
	});

	// A 32-byte Ed25519 key must not be presentable as a truncated 33-byte
	// P-256 one, or the algorithm byte stops meaning anything.
	it('requires the length to match the declared algorithm exactly', () => {
		const cert = signedCert();
		const relabelled = cert.slice();
		relabelled[CAP_MAGIC.length + 1] = SIGNING_ALG.ecdsaP256;
		expect(isCapCert(relabelled)).toBe(false);
	});

	it('rejects a tampered body and a tampered signature', () => {
		const cert = unframeCapCert(signedCert())!;
		expect(capCertSelfSignatureValid(cert)).toBe(true);

		const tamperedBody = signedCert();
		flip(tamperedBody, CAP_MAGIC.length + 6); // inside issuedAt
		expect(capCertSelfSignatureValid(unframeCapCert(tamperedBody)!)).toBe(false);

		const tamperedSig = signedCert();
		flip(tamperedSig, tamperedSig.length - 1, 0x01);
		expect(capCertSelfSignatureValid(unframeCapCert(tamperedSig)!)).toBe(false);
	});

	// Swapping in someone else's key invalidates the self-signature, which is
	// the entire content of the claim.
	it('rejects a certificate whose public key was swapped', () => {
		const other = signingKeypair(new Uint8Array(32).fill(9));
		const cert = signedCert();
		cert.set(other.publicKey, CAP_MAGIC.length + 19);
		expect(capCertSelfSignatureValid(unframeCapCert(cert)!)).toBe(false);
	});

	it('refuses to frame a key of the wrong length', () => {
		expect(() => capCertBody(fields({ publicKey: new Uint8Array(31) }))).toThrow();
		expect(() => frameCapCert(fields(), new Uint8Array(63))).toThrow();
	});
});

describe('proof of possession', () => {
	const certBytes = signedCert();
	const cert = unframeCapCert(certBytes)!;
	const certHash = sha256(certBytes);
	const bodyHash = sha256(new Uint8Array([1, 2, 3]));
	const nonce = new Uint8Array(POP_NONCE_LENGTH).fill(7);

	function makePop(over: Partial<{ method: string; path: string; ts: number; nonce: Uint8Array }> = {}) {
		const ts = over.ts ?? NOW;
		const n = over.nonce ?? nonce;
		const message = popSigningBody({
			certHash,
			method: over.method ?? 'POST',
			path: over.path ?? '/api/incidents/register',
			timestampMs: ts,
			nonce: n,
			bodyHash
		});
		return framePop(ts, n, sign(SIG_CONTEXT.pop, message, SEED));
	}

	it('round-trips and verifies', () => {
		const pop = unframePop(makePop())!;
		expect(isPop(framePop(NOW, nonce, new Uint8Array(64)))).toBe(true);
		expect(pop.timestampMs).toBe(NOW);
		expect(pop.nonce).toEqual(nonce);
		expect(
			popSignatureValid(cert, pop, certHash, 'POST', '/api/incidents/register', bodyHash)
		).toBe(true);
	});

	it('is bound to the method, the path and the body', () => {
		const pop = unframePop(makePop())!;
		expect(popSignatureValid(cert, pop, certHash, 'GET', '/api/incidents/register', bodyHash)).toBe(
			false
		);
		expect(popSignatureValid(cert, pop, certHash, 'POST', '/api/directory/report', bodyHash)).toBe(
			false
		);
		expect(
			popSignatureValid(cert, pop, certHash, 'POST', '/api/incidents/register', sha256(new Uint8Array([9])))
		).toBe(false);
	});

	// Without length prefixes, ("POST", "/a/b") and ("POST/a", "/b") could
	// serialise identically and a proof for one route would work on another.
	it('cannot be confused by moving the method/path boundary', () => {
		const a = popSigningBody({ certHash, method: 'POST', path: '/a/b', timestampMs: NOW, nonce, bodyHash });
		const b = popSigningBody({ certHash, method: 'POSTX', path: 'a/b', timestampMs: NOW, nonce, bodyHash });
		expect(a).not.toEqual(b);
	});

	it('is bound to the certificate it was issued under', () => {
		const pop = unframePop(makePop())!;
		const otherCert = signedCert({ compartment: 'directory' });
		expect(
			popSignatureValid(cert, pop, sha256(otherCert), 'POST', '/api/incidents/register', bodyHash)
		).toBe(false);
	});

	// The domain-separation context is what stops a captured cap-cert signature
	// being presented as a proof of possession, or the reverse.
	it('does not accept a cap-cert signature in a proof slot', () => {
		const lifted = unframePop(framePop(NOW, nonce, cert.signature))!;
		expect(
			popSignatureValid(cert, lifted, certHash, 'POST', '/api/incidents/register', bodyHash)
		).toBe(false);
	});

	it('rejects malformed proofs', () => {
		expect(unframePop(new Uint8Array(POP_LENGTH))).toBeNull(); // no magic
		expect(unframePop(makePop().slice(0, POP_LENGTH - 1))).toBeNull();
		const badVersion = makePop();
		badVersion[4] = 9;
		expect(unframePop(badVersion)).toBeNull();
	});

	it('refuses to build a signing body with the wrong-size parts', () => {
		expect(() =>
			popSigningBody({ certHash: new Uint8Array(31), method: 'POST', path: '/x', timestampMs: NOW, nonce, bodyHash })
		).toThrow();
		expect(() =>
			popSigningBody({ certHash, method: 'POST', path: '/x', timestampMs: NOW, nonce: new Uint8Array(8), bodyHash })
		).toThrow();
	});
});
