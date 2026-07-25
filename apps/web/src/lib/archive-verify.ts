/**
 * Client-side inclusion-proof verifier (ARCHITECTURE §7.2, §16).
 *
 * The whole promise of this module is that it trusts NOTHING we serve. It
 * recomputes the record hash from the canonical record and the previous hash,
 * folds the Merkle path itself, and compares against a root the reader supplies
 * or obtained elsewhere. It lives in apps/web rather than on the api Worker so
 * it inherits the service-worker asset pinning, the strict CSP and Trusted
 * Types, and the signed release; and because every route is prerendered, a third
 * party can save this page and run it offline against a proof from any source.
 *
 * Pure and import-free, so apps/web's DOM-less vitest config can run it. It uses
 * WebCrypto SHA-256 and nothing else, so no `connect-src` widening is needed.
 *
 * `anchored` is typed as the LITERAL false and is not optional. There is no
 * external anchor today (`archive_anchoring` is off), and a UI cannot forget to
 * say so if the type will not let the value be anything else.
 */

export interface CustodyLine {
	seq: number;
	event: string;
	actorBand: string;
	detail: string;
	atBucket: string;
	recordHash: string;
	prevHash: string;
	anchor: string;
}

export interface PathStep {
	hash: string;
	right: boolean;
}

export interface ProofBundle {
	record: CustodyLine;
	path: readonly PathStep[];
	root: string;
}

export type VerifyReason =
	| 'record_hash_mismatch'
	| 'path_does_not_reach_root'
	| 'malformed';

export type VerifyOutcome =
	| { ok: true; root: string; anchored: false }
	| { ok: false; reason: VerifyReason };

const HEX32 = /^[0-9a-f]{64}$/;

function unhex(s: string): Uint8Array {
	const out = new Uint8Array(s.length / 2);
	for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(s.slice(i * 2, i * 2 + 2), 16);
	return out;
}

function hex(bytes: Uint8Array): string {
	let out = '';
	for (const b of bytes) out += b.toString(16).padStart(2, '0');
	return out;
}

async function sha256(...parts: Uint8Array[]): Promise<Uint8Array> {
	let len = 0;
	for (const p of parts) len += p.length;
	const buf = new Uint8Array(len);
	let at = 0;
	for (const p of parts) {
		buf.set(p, at);
		at += p.length;
	}
	return new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
}

/**
 * Byte-identical to `canonicalJson` in @harborage/crypto/pack. Reimplemented
 * rather than imported so this module stays import-free and a reader auditing
 * the verifier can see every byte it hashes without following a dependency.
 * A test cross-checks the two agree.
 */
export function canonicalJsonLocal(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
	if (Array.isArray(value)) return `[${value.map(canonicalJsonLocal).join(',')}]`;
	const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
		a < b ? -1 : a > b ? 1 : 0
	);
	return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJsonLocal(v)}`).join(',')}}`;
}

/** Recompute H_i = SHA256(H_{i-1} ‖ canonicalJson(record)). */
export async function recomputeRecordHash(record: CustodyLine): Promise<string> {
	const canonical = canonicalJsonLocal({
		event: record.event,
		anchor: record.anchor,
		actorBand: record.actorBand,
		detail: record.detail,
		atBucket: record.atBucket
	});
	return hex(await sha256(unhex(record.prevHash), new TextEncoder().encode(canonical)));
}

/** Fold a leaf up its path, with the same domain separation the ledger uses. */
export async function foldInclusionPath(
	leafRecordHash: string,
	path: readonly PathStep[]
): Promise<string> {
	let node = await sha256(new Uint8Array([0x00]), unhex(leafRecordHash));
	for (const step of path) {
		const sibling = unhex(step.hash);
		node = step.right
			? await sha256(new Uint8Array([0x01]), node, sibling)
			: await sha256(new Uint8Array([0x01]), sibling, node);
	}
	return hex(node);
}

export async function verifyInclusion(bundle: ProofBundle): Promise<VerifyOutcome> {
	const { record, path, root } = bundle;
	if (
		!record ||
		!HEX32.test(record.recordHash ?? '') ||
		!HEX32.test(record.prevHash ?? '') ||
		!HEX32.test(record.anchor ?? '') ||
		!HEX32.test(root ?? '') ||
		!Array.isArray(path) ||
		path.some((s) => !HEX32.test(s?.hash ?? '') || typeof s?.right !== 'boolean')
	) {
		return { ok: false, reason: 'malformed' };
	}

	// The record must actually hash to what the ledger claims, or the rest is
	// checking arithmetic over a number nobody tied to the record.
	if ((await recomputeRecordHash(record)) !== record.recordHash) {
		return { ok: false, reason: 'record_hash_mismatch' };
	}
	if ((await foldInclusionPath(record.recordHash, path)) !== root) {
		return { ok: false, reason: 'path_does_not_reach_root' };
	}
	// Deliberately the literal false: nothing outside this system has attested to
	// this root, and the page must say so on every success.
	return { ok: true, root, anchored: false };
}
