import { describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { base64 } from '@scure/base';
import { noticePayloadHash, type NoticePayload } from '@harborage/crypto/notice';
import { publishNotice } from '../src/notices.ts';
import type { ConsoleEnv } from '@harborage/worker-lib/types';

// A minimal D1/DO stub. loadDirectory/loadRevocations run real SQL through
// .prepare().all(); here we return canned result sets keyed by the query text.
function stubEnv(
	directoryRows: unknown[],
	revocationRows: unknown[],
	appended: string[]
): ConsoleEnv {
	const db = {
		prepare(sql: string) {
			const isDir = /from key_directory/i.test(sql);
			const isRev = /from revocation_list/i.test(sql);
			return {
				bind() {
					return this;
				},
				async all() {
					if (isDir) return { results: directoryRows };
					if (isRev) return { results: revocationRows };
					return { results: [] };
				},
				async run() {
					return { success: true };
				}
			};
		}
	};
	const noticeLog = {
		idFromName: (n: string) => n,
		get: () => ({
			async append(n: { id: string }) {
				appended.push(n.id);
				return { seq: appended.length - 1, prev_hash: '0'.repeat(64), entry_hash: 'ab'.repeat(32) };
			},
			async status() {
				return { count: appended.length, head: '0'.repeat(64), lastCheckpointSeq: null };
			}
		})
	};
	return { DB: db, NOTICE_LOG: noticeLog } as unknown as ConsoleEnv;
}

const validBundle = JSON.stringify({
	payload: {
		id: 'ntc_1',
		epoch: 1,
		notice_type: 'safety_directive',
		title_i18n: { en: 'x' },
		body_i18n: { en: 'y' },
		published_at: '2026-07-25'
	},
	signatures: [{ key_id: 'A', sig: 'AAAA' }]
});

describe('publishNotice fails closed', () => {
	it('refuses when the key directory is empty (pre-ceremony) and appends nothing', async () => {
		const appended: string[] = [];
		const r = await publishNotice(stubEnv([], [], appended), validBundle);
		expect(r.ok).toBe(false);
		expect(r.message).toMatch(/no key directory/i);
		expect(appended).toEqual([]);
	});

	it('refuses a malformed bundle', async () => {
		const appended: string[] = [];
		const r = await publishNotice(stubEnv([], [], appended), 'not json');
		expect(r.ok).toBe(false);
		expect(appended).toEqual([]);
	});

	it('refuses a bundle whose signatures do not meet quorum even with a directory', async () => {
		const appended: string[] = [];
		// A directory entry exists but the signature is bogus, so 0 valid signers.
		const dir = [
			{
				key_id: 'A',
				public_key: 'AAAA',
				role: 'official_notice',
				valid_from_epoch: 1,
				valid_to_epoch: null
			}
		];
		const r = await publishNotice(stubEnv(dir, [], appended), validBundle);
		expect(r.ok).toBe(false);
		expect(r.message).toMatch(/not enough valid signatures/i);
		expect(appended).toEqual([]);
	});
});

describe('publishNotice happy path (real signatures reach quorum)', () => {
	function key(fill: number) {
		const seed = new Uint8Array(32).fill(fill);
		return { seed, pub: base64.encode(ed25519.getPublicKey(seed)) };
	}
	it('verifies a 3-of-n safety directive and appends it', async () => {
		const A = key(11);
		const B = key(12);
		const C = key(13);
		const payload: NoticePayload = {
			id: 'ntc_real',
			epoch: 2,
			notice_type: 'safety_directive',
			title_i18n: { en: 'Regroup at the south end' },
			body_i18n: { en: 'Move calmly.' },
			published_at: '2026-07-25'
		};
		const hash = noticePayloadHash(payload);
		const bundle = JSON.stringify({
			payload,
			signatures: [
				{ key_id: 'A', sig: base64.encode(ed25519.sign(hash, A.seed)) },
				{ key_id: 'B', sig: base64.encode(ed25519.sign(hash, B.seed)) },
				{ key_id: 'C', sig: base64.encode(ed25519.sign(hash, C.seed)) }
			]
		});
		const dir = [
			{
				key_id: 'A',
				public_key: A.pub,
				role: 'official_notice',
				valid_from_epoch: 1,
				valid_to_epoch: null
			},
			{
				key_id: 'B',
				public_key: B.pub,
				role: 'official_notice',
				valid_from_epoch: 1,
				valid_to_epoch: null
			},
			{
				key_id: 'C',
				public_key: C.pub,
				role: 'official_notice',
				valid_from_epoch: 1,
				valid_to_epoch: null
			}
		];
		const appended: string[] = [];
		const r = await publishNotice(stubEnv(dir, [], appended), bundle);
		expect(r.ok).toBe(true);
		expect(r.seq).toBe(0);
		expect(appended).toEqual(['ntc_real']);
	});
});
