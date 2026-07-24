/**
 * Official-notice signature verification (ARCHITECTURE §5.5, §2 row 2; PRD §4.2).
 * Independent m-of-n Ed25519 multisig over a canonical notice payload, checked
 * against a signed Key Directory + Revocation List. Verify-only — signing is an
 * offline hardware-token ceremony, never in this codebase. Lives in the frozen
 * crypto module (CODEOWNERS): a hijacked account or compelled CDN must not be
 * able to mint a valid directive.
 *
 * m-of-n is INDEPENDENT multisig (m distinct role keys each sign), not a
 * threshold scheme — FROST is deferred (ARCHITECTURE §5.5). Because the key
 * directory ships empty until the offline ceremony, every verify fails closed:
 * nothing can be presented as an authentic notice until real role keys exist.
 */
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { base64 } from '@scure/base';
import { canonicalJson } from './pack.ts';

export type NoticeType =
	| 'safety_directive'
	| 'logistics'
	| 'legal_status'
	| 'correction'
	| 'detention_alert'
	| 'transparency';

/**
 * Independent signatures required per notice type (ARCHITECTURE §5.5 "directive-
 * type policy"; PRD §4.2 names disperse/route-change/stand-down high-stakes).
 * COUNSEL-GATED and tunable UPWARD only: raising m is always safe, lowering it
 * needs sign-off. High-stakes types demand more independent signers.
 */
export const REQUIRED_SIGNATURES: Record<NoticeType, number> = {
	safety_directive: 3,
	detention_alert: 3,
	logistics: 2,
	legal_status: 2,
	correction: 2,
	transparency: 2
};

/** The signed portion of a notice — exactly these fields, canonically ordered. */
export interface NoticePayload {
	id: string;
	epoch: number;
	notice_type: NoticeType;
	title_i18n: Record<string, string>;
	body_i18n: Record<string, string>;
	area?: string;
	published_at: string;
	supersedes?: string;
}

export interface KeyDirectoryEntry {
	key_id: string;
	public_key: string; // base64 Ed25519
	role: string;
	valid_from_epoch: number;
	valid_to_epoch: number | null;
}

export interface RevocationEntry {
	key_id: string;
	revoked_at_epoch: number;
}

export interface NoticeSignature {
	key_id: string;
	sig: string; // base64 Ed25519 over the 32-byte payload hash
}

const ZERO_HASH_HEX = '0'.repeat(64);

function hex(bytes: Uint8Array): string {
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(h: string): Uint8Array {
	const out = new Uint8Array(h.length / 2);
	for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
	return out;
}

/** The 32-byte payload hash the signers sign. */
export function noticePayloadHash(payload: NoticePayload): Uint8Array {
	return sha256(new TextEncoder().encode(canonicalJson(payload)));
}

export function noticePayloadHashHex(payload: NoticePayload): string {
	return hex(noticePayloadHash(payload));
}

export interface NoticeVerification {
	valid: boolean;
	validSigners: string[];
	required: number;
	reason?: string;
}

/**
 * Verify a notice: recompute its payload hash, then count DISTINCT signers whose
 * signature verifies AND who pass the four client checks (ARCHITECTURE §5.5):
 * signer in directory, signer NOT revoked, notice epoch within key validity, and
 * (caller) revocation-list freshness. Valid iff distinct valid signers >= m for
 * the notice type. `requiredRole` binds notices to the official-notice role.
 */
export function verifyNotice(
	payload: NoticePayload,
	signatures: readonly NoticeSignature[],
	storedPayloadHashHex: string,
	directory: readonly KeyDirectoryEntry[],
	revocations: readonly RevocationEntry[],
	requiredRole = 'official_notice'
): NoticeVerification {
	const required = REQUIRED_SIGNATURES[payload.notice_type];
	const hashBytes = noticePayloadHash(payload);
	if (hex(hashBytes) !== storedPayloadHashHex)
		return { valid: false, validSigners: [], required, reason: 'payload hash mismatch' };

	const dir = new Map(directory.map((e) => [e.key_id, e]));
	const revoked = new Set(revocations.map((r) => r.key_id));
	const validSigners = new Set<string>();

	for (const s of signatures) {
		const entry = dir.get(s.key_id);
		if (!entry) continue; // signer not in directory
		if (revoked.has(s.key_id)) continue; // signer revoked
		if (entry.role !== requiredRole) continue; // wrong role binding
		if (payload.epoch < entry.valid_from_epoch) continue; // before key validity
		if (entry.valid_to_epoch !== null && payload.epoch > entry.valid_to_epoch) continue; // after
		try {
			if (ed25519.verify(base64.decode(s.sig), hashBytes, base64.decode(entry.public_key)))
				validSigners.add(s.key_id);
		} catch {
			// malformed signature/key — skip this signer
		}
	}

	return { valid: validSigners.size >= required, validSigners: [...validSigners], required };
}

/**
 * A long-offline client can honor a revoked key until it sees a newer list.
 * The freshness floor rejects a rolled-back stale list: the presented list epoch
 * must be at least the min-revocation-epoch the client already knows.
 */
export function revocationListFresh(listEpoch: number, minRevocationEpoch: number): boolean {
	return listEpoch >= minRevocationEpoch;
}

// --- Append-only hash chain (ARCHITECTURE §7.2 form, §4.2 for notices) --------

/** entry_i = SHA-256( H_{i-1} || payload_hash_i ), all hex. */
export function noticeChainEntry(prevHashHex: string, payloadHashHex: string): string {
	const combined = new Uint8Array([...hexToBytes(prevHashHex), ...hexToBytes(payloadHashHex)]);
	return hex(sha256(combined));
}

export interface NoticeChainLink {
	prev_hash: string;
	entry_hash: string;
	payload_hash: string;
}

/** True iff the chain is contiguous from the zero root with correct link hashes. */
export function verifyNoticeChain(links: readonly NoticeChainLink[]): boolean {
	let prev = ZERO_HASH_HEX;
	for (const link of links) {
		if (link.prev_hash !== prev) return false;
		if (noticeChainEntry(link.prev_hash, link.payload_hash) !== link.entry_hash) return false;
		prev = link.entry_hash;
	}
	return true;
}

export const NOTICE_CHAIN_ROOT = ZERO_HASH_HEX;
