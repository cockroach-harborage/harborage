/**
 * Signed knowledge-pack verification (ARCHITECTURE §5.6). A pack bundles
 * PUBLIC-PLAINTEXT content, is signed offline by the m-of-n project key
 * (minisign), and is verified in-app against a pinned public key. This is the
 * root of content trust, so it lives in the frozen crypto module under
 * CODEOWNERS review. Verify-only — nothing here signs.
 *
 * A pack's authenticity is a minisign signature over its exact bytes; its
 * integrity is a self-consistent {path:sha256} manifest. Trust requires BOTH,
 * plus a pinned key. The canonical serialization here is byte-identical to
 * tools/pack/canonical.mjs (the offline builder) so a manifest hash produced
 * offline matches one recomputed on-device.
 */
import { parsePublicKey, verifyMinisign } from './minisign.ts';
import { sha256 } from '@noble/hashes/sha2.js';

export interface Pack {
	format: string;
	name: string;
	epoch: number;
	manifest: Record<string, string>;
	files: Record<string, unknown>;
}

/** Object keys sorted, arrays order-preserved, compact. Deterministic. */
export function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value);
	if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
	const obj = value as Record<string, unknown>;
	const keys = Object.keys(obj).sort();
	return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
}

function hex(bytes: Uint8Array): string {
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Parse pack bytes into a Pack, or null if the shape is wrong. */
export function parsePack(bytes: Uint8Array): Pack | null {
	try {
		const obj = JSON.parse(new TextDecoder().decode(bytes)) as Pack;
		if (
			obj.format !== 'harborage-pack/v1' ||
			typeof obj.manifest !== 'object' ||
			obj.manifest === null ||
			typeof obj.files !== 'object' ||
			obj.files === null
		)
			return null;
		return obj;
	} catch {
		return null;
	}
}

/**
 * The manifest is self-consistent: exactly the listed files exist and every
 * canonical hash matches. Integrity, not authenticity — a signature still gates
 * trust. Synchronous (noble SHA-256), so it works with no WebCrypto dependency.
 */
export function verifyPackManifest(pack: Pack): boolean {
	const manifestKeys = Object.keys(pack.manifest).sort();
	const fileKeys = Object.keys(pack.files).sort();
	if (manifestKeys.length !== fileKeys.length) return false;
	for (let i = 0; i < manifestKeys.length; i++) if (manifestKeys[i] !== fileKeys[i]) return false;
	for (const path of manifestKeys) {
		const actual = hex(sha256(new TextEncoder().encode(canonicalJson(pack.files[path]))));
		if (pack.manifest[path] !== actual) return false;
	}
	return true;
}

/** True if a detached minisign signature verifies against any pinned key. */
export function verifyPackSignature(
	packBytes: Uint8Array,
	signatureFile: string,
	pinnedPublicKeys: readonly string[]
): boolean {
	if (pinnedPublicKeys.length === 0 || !signatureFile) return false;
	for (const pinned of pinnedPublicKeys) {
		try {
			if (verifyMinisign(parsePublicKey(pinned), packBytes, signatureFile).valid) return true;
		} catch {
			// try the next pinned key
		}
	}
	return false;
}

/** Full trust check: authentic (pinned-key signature) AND self-consistent manifest. */
export function verifyPack(
	packBytes: Uint8Array,
	signatureFile: string,
	pinnedPublicKeys: readonly string[]
): boolean {
	if (!verifyPackSignature(packBytes, signatureFile, pinnedPublicKeys)) return false;
	const pack = parsePack(packBytes);
	return pack !== null && verifyPackManifest(pack);
}
