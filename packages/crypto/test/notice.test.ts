import { describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { base64 } from '@scure/base';
import {
	verifyNotice,
	noticePayloadHashHex,
	noticePayloadHash,
	revocationListFresh,
	noticeChainEntry,
	verifyNoticeChain,
	NOTICE_CHAIN_ROOT,
	REQUIRED_SIGNATURES,
	type NoticePayload,
	type KeyDirectoryEntry,
	type NoticeSignature
} from '../src/notice.ts';

// ---- TEST-ONLY signer helpers. Production signing is an offline ceremony.
function keypair(fill: number) {
	const seed = new Uint8Array(32).fill(fill);
	return { seed, pub: base64.encode(ed25519.getPublicKey(seed)) };
}
function dirEntry(
	key_id: string,
	pub: string,
	over: Partial<KeyDirectoryEntry> = {}
): KeyDirectoryEntry {
	return {
		key_id,
		public_key: pub,
		role: 'official_notice',
		valid_from_epoch: 1,
		valid_to_epoch: null,
		...over
	};
}
function signPayload(seed: Uint8Array, payload: NoticePayload): string {
	return base64.encode(ed25519.sign(noticePayloadHash(payload), seed));
}

const A = keypair(1);
const B = keypair(2);
const C = keypair(3);
const D = keypair(4);

const directory: KeyDirectoryEntry[] = [
	dirEntry('A', A.pub),
	dirEntry('B', B.pub),
	dirEntry('C', C.pub),
	dirEntry('D', D.pub)
];

function directive(over: Partial<NoticePayload> = {}): NoticePayload {
	return {
		id: 'ntc_1',
		epoch: 5,
		notice_type: 'safety_directive',
		title_i18n: { en: 'Move away from the north gate', hi: 'उत्तरी गेट से दूर हटें' },
		body_i18n: { en: 'Organizers ask people to move south.', hi: '' },
		area: 'north gate',
		published_at: '2026-07-25',
		...over
	};
}

describe('notice m-of-n verification', () => {
	it('accepts a directive with the required 3 independent signatures', () => {
		const p = directive();
		const hash = noticePayloadHashHex(p);
		const sigs: NoticeSignature[] = [
			{ key_id: 'A', sig: signPayload(A.seed, p) },
			{ key_id: 'B', sig: signPayload(B.seed, p) },
			{ key_id: 'C', sig: signPayload(C.seed, p) }
		];
		const r = verifyNotice(p, sigs, hash, directory, []);
		expect(r.required).toBe(REQUIRED_SIGNATURES.safety_directive);
		expect(r.valid).toBe(true);
		expect(r.validSigners.sort()).toEqual(['A', 'B', 'C']);
	});

	it('rejects a directive one signature short of quorum', () => {
		const p = directive();
		const sigs = [
			{ key_id: 'A', sig: signPayload(A.seed, p) },
			{ key_id: 'B', sig: signPayload(B.seed, p) }
		];
		expect(verifyNotice(p, sigs, noticePayloadHashHex(p), directory, []).valid).toBe(false);
	});

	it('fails closed against an empty directory (pre-ceremony)', () => {
		const p = directive();
		const sigs = [{ key_id: 'A', sig: signPayload(A.seed, p) }];
		expect(verifyNotice(p, sigs, noticePayloadHashHex(p), [], []).valid).toBe(false);
	});

	it('rejects a signature from a revoked key', () => {
		const p = directive();
		const sigs = [
			{ key_id: 'A', sig: signPayload(A.seed, p) },
			{ key_id: 'B', sig: signPayload(B.seed, p) },
			{ key_id: 'C', sig: signPayload(C.seed, p) }
		];
		const r = verifyNotice(p, sigs, noticePayloadHashHex(p), directory, [
			{ key_id: 'C', revoked_at_epoch: 4 }
		]);
		expect(r.valid).toBe(false); // only 2 valid now
	});

	it('rejects a signature outside the key validity window', () => {
		const p = directive({ epoch: 5 });
		const narrow = [
			dirEntry('A', A.pub, { valid_from_epoch: 1, valid_to_epoch: 3 }), // expired by epoch 5
			dirEntry('B', B.pub),
			dirEntry('C', C.pub)
		];
		const sigs = [
			{ key_id: 'A', sig: signPayload(A.seed, p) },
			{ key_id: 'B', sig: signPayload(B.seed, p) },
			{ key_id: 'C', sig: signPayload(C.seed, p) }
		];
		expect(verifyNotice(p, sigs, noticePayloadHashHex(p), narrow, []).valid).toBe(false);
	});

	it('rejects a tampered payload (hash mismatch)', () => {
		const p = directive();
		const hash = noticePayloadHashHex(p);
		const sigs = [
			{ key_id: 'A', sig: signPayload(A.seed, p) },
			{ key_id: 'B', sig: signPayload(B.seed, p) },
			{ key_id: 'C', sig: signPayload(C.seed, p) }
		];
		const tampered = directive({ body_i18n: { en: 'Move NORTH into the police line.', hi: '' } });
		expect(verifyNotice(tampered, sigs, hash, directory, []).valid).toBe(false);
	});

	it('rejects a valid signature bound to the wrong role', () => {
		const p = directive();
		const wrongRole = [
			dirEntry('A', A.pub, { role: 'canary' }),
			dirEntry('B', B.pub, { role: 'canary' }),
			dirEntry('C', C.pub, { role: 'canary' })
		];
		const sigs = [
			{ key_id: 'A', sig: signPayload(A.seed, p) },
			{ key_id: 'B', sig: signPayload(B.seed, p) },
			{ key_id: 'C', sig: signPayload(C.seed, p) }
		];
		expect(verifyNotice(p, sigs, noticePayloadHashHex(p), wrongRole, []).valid).toBe(false);
	});

	it('does not double-count one key signing twice', () => {
		const p = directive();
		const sigs = [
			{ key_id: 'A', sig: signPayload(A.seed, p) },
			{ key_id: 'A', sig: signPayload(A.seed, p) },
			{ key_id: 'B', sig: signPayload(B.seed, p) }
		];
		expect(verifyNotice(p, sigs, noticePayloadHashHex(p), directory, []).valid).toBe(false);
	});

	it('lets a 2-of-n type pass with two signatures', () => {
		const p = directive({ notice_type: 'logistics' });
		const sigs = [
			{ key_id: 'A', sig: signPayload(A.seed, p) },
			{ key_id: 'B', sig: signPayload(B.seed, p) }
		];
		expect(verifyNotice(p, sigs, noticePayloadHashHex(p), directory, []).valid).toBe(true);
	});
});

describe('revocation freshness', () => {
	it('rejects a rolled-back stale list', () => {
		expect(revocationListFresh(4, 5)).toBe(false);
		expect(revocationListFresh(5, 5)).toBe(true);
		expect(revocationListFresh(6, 5)).toBe(true);
	});
});

describe('notice hash chain', () => {
	it('verifies a contiguous chain from the zero root', () => {
		const h1 = 'aa'.repeat(32);
		const h2 = 'bb'.repeat(32);
		const e1 = noticeChainEntry(NOTICE_CHAIN_ROOT, h1);
		const e2 = noticeChainEntry(e1, h2);
		const links = [
			{ prev_hash: NOTICE_CHAIN_ROOT, entry_hash: e1, payload_hash: h1 },
			{ prev_hash: e1, entry_hash: e2, payload_hash: h2 }
		];
		expect(verifyNoticeChain(links)).toBe(true);
	});

	it('detects a removed / reordered link', () => {
		const h1 = 'aa'.repeat(32);
		const h2 = 'bb'.repeat(32);
		const e1 = noticeChainEntry(NOTICE_CHAIN_ROOT, h1);
		const e2 = noticeChainEntry(e1, h2);
		// second link claims to follow the root, not e1 — a silent removal
		const broken = [{ prev_hash: NOTICE_CHAIN_ROOT, entry_hash: e2, payload_hash: h2 }];
		expect(verifyNoticeChain(broken)).toBe(false);
	});
});
