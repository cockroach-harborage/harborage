/**
 * Minisign signature verification (§5.6): release artifacts and offline
 * knowledge packs are signed by the offline m-of-n project key; the client
 * verifies against the pinned public key. Verify-only — signing happens
 * offline, never in this codebase.
 *
 * Formats (minisign.c / rsign2):
 *   public key line: base64( alg(2) || key_id(8) || ed25519_pk(32) )
 *   signature file:
 *     line 1: untrusted comment
 *     line 2: base64( alg(2) || key_id(8) || signature(64) )
 *     line 3: "trusted comment: ..."
 *     line 4: base64( global_signature(64) )  — over signature || trusted_comment
 *   alg "Ed" = pure ed25519 over the file; "ED" = ed25519 over BLAKE2b-512(file).
 */
import { ed25519 } from '@noble/curves/ed25519.js';
import { blake2b } from '@noble/hashes/blake2.js';
import { base64 } from '@scure/base';

export interface MinisignPublicKey {
	keyId: Uint8Array;
	publicKey: Uint8Array;
}

export function parsePublicKey(input: string): MinisignPublicKey {
	const line = input
		.split('\n')
		.map((l) => l.trim())
		.filter((l) => l.length > 0 && !l.startsWith('untrusted comment:'))[0];
	if (!line) throw new Error('no public key line');
	const raw = base64.decode(line);
	if (raw.length !== 42) throw new Error('bad public key length');
	const alg = new TextDecoder().decode(raw.subarray(0, 2));
	if (alg !== 'Ed') throw new Error(`unsupported public key algorithm: ${alg}`);
	return { keyId: raw.subarray(2, 10), publicKey: raw.subarray(10, 42) };
}

export interface VerifyResult {
	valid: boolean;
	trustedComment?: string;
}

export function verifyMinisign(
	pub: MinisignPublicKey,
	message: Uint8Array,
	signatureFile: string
): VerifyResult {
	try {
		const lines = signatureFile.split('\n').map((l) => l.trim());
		const sigLine = lines[1];
		const trustedLine = lines[2];
		const globalLine = lines[3];
		if (!sigLine || !trustedLine || !globalLine) return { valid: false };

		const sigRaw = base64.decode(sigLine);
		if (sigRaw.length !== 74) return { valid: false };
		const alg = new TextDecoder().decode(sigRaw.subarray(0, 2));
		const keyId = sigRaw.subarray(2, 10);
		const signature = sigRaw.subarray(10, 74);

		if (!constantTimeEqual(keyId, pub.keyId)) return { valid: false };

		let signed: Uint8Array;
		if (alg === 'Ed') signed = message;
		else if (alg === 'ED') signed = blake2b(message, { dkLen: 64 });
		else return { valid: false };

		if (!ed25519.verify(signature, signed, pub.publicKey)) return { valid: false };

		const prefix = 'trusted comment: ';
		if (!trustedLine.startsWith(prefix)) return { valid: false };
		const trustedComment = trustedLine.slice(prefix.length);
		const globalSig = base64.decode(globalLine);
		const globalMessage = concat(signature, new TextEncoder().encode(trustedComment));
		if (!ed25519.verify(globalSig, globalMessage, pub.publicKey)) return { valid: false };

		return { valid: true, trustedComment };
	} catch {
		return { valid: false };
	}
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
	const out = new Uint8Array(a.length + b.length);
	out.set(a);
	out.set(b, a.length);
	return out;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
	return diff === 0;
}
