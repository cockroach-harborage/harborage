/**
 * Self-issued capability certificate + per-request proof of possession (§17.6).
 *
 * READ THIS FIRST, because the name invites the wrong reading: a cap-cert is
 * NOT an authorization grant and NOT a session. There is no issuer, no
 * issuance endpoint, and no platform-held key. A client mints one for itself,
 * signs it with its own compartment key, and the server learns exactly one
 * thing from it: that whoever sent this request holds the private half of this
 * public key, in this compartment, right now. That is what keeps "no session
 * table, no account row" literally true.
 *
 * It therefore provides ZERO Sybil resistance. Anyone can mint unlimited
 * cap-certs for free. Resistance comes from Turnstile, the rate ladder, and
 * reputation — never from the certificate. Do not add a check here and treat
 * it as an authorization decision.
 *
 * What it does buy: a stable, pseudonymous, per-compartment subject to
 * rate-limit and accrue reputation against, without the platform holding a
 * roster of who exists.
 *
 * No ambient globals and no randomness: the caller supplies both, so Workers
 * can import this directly.
 *
 * Wire layout, cap-cert:
 *   MAGIC("HBC1", 4B) ‖ version(1B) ‖ algId(1B) ‖ compartment(1B)
 *   ‖ issuedAt(8B, u64be ms) ‖ expiresAt(8B, u64be ms)
 *   ‖ publicKey(32B Ed25519 | 33B compressed P-256) ‖ selfSig(64B)
 *
 * Wire layout, proof of possession:
 *   MAGIC("HBP1", 4B) ‖ version(1B) ‖ timestamp(8B, u64be ms)
 *   ‖ nonce(16B) ‖ signature(64B)
 */
import {
	compartmentFromOrdinal,
	compartmentOrdinal,
	isSigningAlgId,
	PUBLIC_KEY_LENGTH,
	SIGNATURE_LENGTH,
	SIG_CONTEXT,
	type Compartment,
	type SigningAlgId
} from './compartments.ts';
import { verifyContextSignature } from './signature.ts';

/** "HBC1" — Harborage Capability v1. */
export const CAP_MAGIC = new Uint8Array([0x48, 0x42, 0x43, 0x31]);
/** "HBP1" — Harborage Proof v1. */
export const POP_MAGIC = new Uint8Array([0x48, 0x42, 0x50, 0x31]);

export const CAP_VERSION = 1;
export const POP_VERSION = 1;
export const POP_NONCE_LENGTH = 16;

const CAP_HEADER_LEN = CAP_MAGIC.length + 1 + 1 + 1 + 8 + 8; // magic..expiresAt
const POP_HEADER_LEN = POP_MAGIC.length + 1 + 8; // magic..timestamp

/** Body = everything the self-signature covers (header + public key). */
export function capCertBodyLength(algId: SigningAlgId): number {
	return CAP_HEADER_LEN + PUBLIC_KEY_LENGTH[algId];
}

export function capCertLength(algId: SigningAlgId): number {
	return capCertBodyLength(algId) + SIGNATURE_LENGTH;
}

export const MIN_CAP_CERT_LEN = CAP_HEADER_LEN + 32 + SIGNATURE_LENGTH;
export const MAX_CAP_CERT_LEN = CAP_HEADER_LEN + 33 + SIGNATURE_LENGTH;
export const POP_LENGTH = POP_HEADER_LEN + POP_NONCE_LENGTH + SIGNATURE_LENGTH;

export interface CapCertFields {
	algId: SigningAlgId;
	compartment: Compartment;
	issuedAtMs: number;
	expiresAtMs: number;
	publicKey: Uint8Array;
}

export interface CapCert extends CapCertFields {
	version: number;
	/** The exact bytes the self-signature covers. */
	body: Uint8Array;
	signature: Uint8Array;
	/** The full certificate as received, so a hash binds to what was sent. */
	bytes: Uint8Array;
}

export interface Pop {
	version: number;
	timestampMs: number;
	nonce: Uint8Array;
	signature: Uint8Array;
}

function u64be(target: Uint8Array, offset: number, value: number): void {
	// Milliseconds since epoch fits in 2^53, so the high 2 bytes are always
	// zero; writing via BigInt keeps the layout honest about being 64-bit.
	let v = BigInt(Math.trunc(value));
	for (let i = 7; i >= 0; i--) {
		target[offset + i] = Number(v & 0xffn);
		v >>= 8n;
	}
}

function readU64be(source: Uint8Array, offset: number): number {
	let v = 0n;
	for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(source[offset + i] ?? 0);
	return Number(v);
}

function startsWith(buf: Uint8Array, magic: Uint8Array): boolean {
	if (buf.length < magic.length) return false;
	for (let i = 0; i < magic.length; i++) if (buf[i] !== magic[i]) return false;
	return true;
}

/** The bytes a client signs to self-issue. Also what a verifier re-derives. */
export function capCertBody(fields: CapCertFields): Uint8Array {
	const expected = PUBLIC_KEY_LENGTH[fields.algId];
	if (fields.publicKey.length !== expected)
		throw new Error(`public key must be ${expected} bytes for this algorithm`);
	const out = new Uint8Array(capCertBodyLength(fields.algId));
	out.set(CAP_MAGIC, 0);
	out[CAP_MAGIC.length] = CAP_VERSION;
	out[CAP_MAGIC.length + 1] = fields.algId;
	out[CAP_MAGIC.length + 2] = compartmentOrdinal(fields.compartment);
	u64be(out, CAP_MAGIC.length + 3, fields.issuedAtMs);
	u64be(out, CAP_MAGIC.length + 11, fields.expiresAtMs);
	out.set(fields.publicKey, CAP_HEADER_LEN);
	return out;
}

export function frameCapCert(fields: CapCertFields, signature: Uint8Array): Uint8Array {
	if (signature.length !== SIGNATURE_LENGTH)
		throw new Error(`signature must be ${SIGNATURE_LENGTH} bytes`);
	const body = capCertBody(fields);
	const out = new Uint8Array(body.length + signature.length);
	out.set(body, 0);
	out.set(signature, body.length);
	return out;
}

/** Shape only: no signature check, no clock check. Both live in worker-lib. */
export function isCapCert(buf: Uint8Array): boolean {
	if (buf.length < MIN_CAP_CERT_LEN || buf.length > MAX_CAP_CERT_LEN) return false;
	if (!startsWith(buf, CAP_MAGIC)) return false;
	if (buf[CAP_MAGIC.length] !== CAP_VERSION) return false;
	const algId = buf[CAP_MAGIC.length + 1];
	if (algId === undefined || !isSigningAlgId(algId)) return false;
	// Length must match the algorithm exactly, so a 32-byte key cannot be
	// presented as a truncated 33-byte one or the reverse.
	if (buf.length !== capCertLength(algId)) return false;
	const ordinal = buf[CAP_MAGIC.length + 2];
	return ordinal !== undefined && compartmentFromOrdinal(ordinal) !== null;
}

export function unframeCapCert(buf: Uint8Array): CapCert | null {
	if (!isCapCert(buf)) return null;
	const algId = buf[CAP_MAGIC.length + 1] as SigningAlgId;
	const compartment = compartmentFromOrdinal(buf[CAP_MAGIC.length + 2] ?? -1);
	if (compartment === null) return null;
	const bodyLen = capCertBodyLength(algId);
	return {
		version: CAP_VERSION,
		algId,
		compartment,
		issuedAtMs: readU64be(buf, CAP_MAGIC.length + 3),
		expiresAtMs: readU64be(buf, CAP_MAGIC.length + 11),
		publicKey: buf.subarray(CAP_HEADER_LEN, bodyLen),
		body: buf.subarray(0, bodyLen),
		signature: buf.subarray(bodyLen),
		bytes: buf
	};
}

/** Self-signature only. Says nothing about time, compartment policy or reach. */
export function capCertSelfSignatureValid(cert: CapCert): boolean {
	return verifyContextSignature(
		cert.algId,
		cert.publicKey,
		cert.signature,
		SIG_CONTEXT.capCert,
		cert.body
	);
}

// --- Proof of possession -----------------------------------------------------

/**
 * The bytes a PoP signs. Everything that could be swapped by an attacker
 * replaying a captured proof is inside it: which certificate, which method,
 * which path, when, which nonce, and which body.
 *
 * Method and path are length-prefixed rather than separator-joined, so
 * ("POST", "/a/b") and ("POST/a", "/b") cannot produce the same bytes.
 */
export function popSigningBody(input: {
	certHash: Uint8Array;
	method: string;
	path: string;
	timestampMs: number;
	nonce: Uint8Array;
	bodyHash: Uint8Array;
}): Uint8Array {
	const enc = new TextEncoder();
	const method = enc.encode(input.method.toUpperCase());
	const path = enc.encode(input.path);
	if (method.length > 0xff) throw new Error('method too long');
	if (path.length > 0xffff) throw new Error('path too long');
	if (input.certHash.length !== 32 || input.bodyHash.length !== 32)
		throw new Error('hashes must be 32 bytes');
	if (input.nonce.length !== POP_NONCE_LENGTH)
		throw new Error(`nonce must be ${POP_NONCE_LENGTH} bytes`);

	const out = new Uint8Array(
		32 + 1 + method.length + 2 + path.length + 8 + POP_NONCE_LENGTH + 32
	);
	let o = 0;
	out.set(input.certHash, o);
	o += 32;
	out[o++] = method.length;
	out.set(method, o);
	o += method.length;
	out[o++] = (path.length >> 8) & 0xff;
	out[o++] = path.length & 0xff;
	out.set(path, o);
	o += path.length;
	u64be(out, o, input.timestampMs);
	o += 8;
	out.set(input.nonce, o);
	o += POP_NONCE_LENGTH;
	out.set(input.bodyHash, o);
	return out;
}

export function framePop(timestampMs: number, nonce: Uint8Array, signature: Uint8Array): Uint8Array {
	if (nonce.length !== POP_NONCE_LENGTH) throw new Error('bad nonce length');
	if (signature.length !== SIGNATURE_LENGTH) throw new Error('bad signature length');
	const out = new Uint8Array(POP_LENGTH);
	out.set(POP_MAGIC, 0);
	out[POP_MAGIC.length] = POP_VERSION;
	u64be(out, POP_MAGIC.length + 1, timestampMs);
	out.set(nonce, POP_HEADER_LEN);
	out.set(signature, POP_HEADER_LEN + POP_NONCE_LENGTH);
	return out;
}

export function isPop(buf: Uint8Array): boolean {
	return (
		buf.length === POP_LENGTH &&
		startsWith(buf, POP_MAGIC) &&
		buf[POP_MAGIC.length] === POP_VERSION
	);
}

export function unframePop(buf: Uint8Array): Pop | null {
	if (!isPop(buf)) return null;
	return {
		version: POP_VERSION,
		timestampMs: readU64be(buf, POP_MAGIC.length + 1),
		nonce: buf.subarray(POP_HEADER_LEN, POP_HEADER_LEN + POP_NONCE_LENGTH),
		signature: buf.subarray(POP_HEADER_LEN + POP_NONCE_LENGTH)
	};
}

/** PoP signature only. Freshness and replay are the caller's job. */
export function popSignatureValid(
	cert: CapCert,
	pop: Pop,
	certHash: Uint8Array,
	method: string,
	path: string,
	bodyHash: Uint8Array
): boolean {
	let message: Uint8Array;
	try {
		message = popSigningBody({
			certHash,
			method,
			path,
			timestampMs: pop.timestampMs,
			nonce: pop.nonce,
			bodyHash
		});
	} catch {
		return false;
	}
	return verifyContextSignature(
		cert.algId,
		cert.publicKey,
		pop.signature,
		SIG_CONTEXT.pop,
		message
	);
}
