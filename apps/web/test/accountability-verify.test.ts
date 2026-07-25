/**
 * The layer a compelled Worker cannot defeat.
 *
 * Every other check in the naming path is code we run, and a compulsion order can
 * require us to skip an `if`. This one runs on the reader's device against keys
 * pinned in a signed release, so the only way past it is a forged reviewer
 * signature — and the platform holds no reviewer secret key to forge one with.
 * Those keys are generated in an offline ceremony and never enter the repo, CI, or
 * Cloudflare. packages/crypto DOES export a generic Ed25519 sign(); it needs a key
 * the platform does not have.
 *
 * THE TESTS MINT A REAL REVIEWER DIRECTORY. With the pinned set empty every call
 * fails, so a suite that only used the production directory would pass with
 * verifyNaming() replaced by `return {named: false}`. The injected directory is
 * what makes the failures mean something: each one is measured against a control
 * that genuinely succeeds.
 *
 * Signing goes through hkdf-tree's sign(), which is what a reviewer's device uses,
 * rather than reaching for @noble directly. Two reasons: it needs no dependency
 * apps/web does not already have, and gate-sig-context bans a raw `ed25519.sign`
 * outside that module precisely so no caller can forget the domain-separation tag.
 */
import { describe, expect, it } from 'vitest';
import { SIG_CONTEXT } from '@harborage/crypto/compartments';
import { sign, signingKeypair } from '@harborage/crypto/hkdf-tree';
import type { KeyDirectoryEntry } from '@harborage/crypto/notice';
import {
	institutionalView,
	namingRecordHash,
	NAMING_MIN_KEYS,
	NAMING_REQUIRED,
	PINNED_REVIEWER_KEYS,
	verifyNaming,
	type NamingRecord,
	type SignedRecord
} from '../src/lib/accountability-verify.ts';

const EPOCH = 5;

function b64(bytes: Uint8Array): string {
	let out = '';
	for (const b of bytes) out += String.fromCharCode(b);
	return btoa(out);
}

function unb64(s: string): Uint8Array {
	const bin = atob(s);
	return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function keypair(seed: number) {
	const priv = new Uint8Array(32).fill(seed);
	return { priv, pub: b64(signingKeypair(priv).publicKey) };
}

function entry(id: string, seed: number, over: Partial<KeyDirectoryEntry> = {}): KeyDirectoryEntry {
	return {
		key_id: id,
		public_key: keypair(seed).pub,
		role: 'naming_reviewer',
		valid_from_epoch: 1,
		valid_to_epoch: null,
		...over
	};
}

const DIRECTORY = [entry('r1', 31), entry('r2', 32), entry('r3', 33)];

const RECORD: NamingRecord = {
	id: 'acct_01HQ',
	station_code: 'PS-DL-0042',
	unit_code: 'UNIT-3',
	rank_band: 'inspector_band',
	shift_bucket: 'night',
	region_bucket: 'IN-DL',
	incident_ref: 'inc_9f2',
	documentary_anchor_sha256: 'c'.repeat(64),
	official_name: 'Officer On Duty',
	official_badge: 'BADGE-771',
	right_of_reply_ref: 'ror_44',
	corroboration_count: 4,
	directory_epoch: EPOCH
};

function hexToBytes(hex: string): Uint8Array {
	const out = new Uint8Array(hex.length / 2);
	for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	return out;
}

/** Sign the canonical hash the way a reviewer's device would. */
async function signedBy(seeds: number[], record: NamingRecord = RECORD): Promise<SignedRecord> {
	const hash = await namingRecordHash(record);
	const message = hexToBytes(hash);
	return {
		record,
		record_hash: hash,
		signatures: seeds.map((seed, i) => ({
			key_id: `r${i + 1}`,
			sig: b64(sign(SIG_CONTEXT.namingRecord, message, keypair(seed).priv))
		}))
	};
}

const withDirectory = { directory: DIRECTORY };

describe('the resting state names nobody', () => {
	/**
	 * No reviewer key is pinned, so no bundle verifies and every record renders
	 * institutionally. Switch-on needs an offline m-of-n ceremony that no code path
	 * can substitute for.
	 */
	it('pins no reviewer keys, so a perfectly valid bundle still names nobody', async () => {
		expect(PINNED_REVIEWER_KEYS).toHaveLength(0);
		const signed = await signedBy([31, 32]);
		expect(await verifyNaming(signed)).toEqual({ named: false, reason: 'no_quorum' });
	});
});

describe('a valid bundle names, so the refusals below mean something', () => {
	it('names when the quorum holds', async () => {
		const v = await verifyNaming(await signedBy([31, 32]), withDirectory);
		expect(v).toMatchObject({ named: true, name: 'Officer On Duty', badge: 'BADGE-771' });
	});

	it('reports which keys signed, and only the valid ones', async () => {
		const v = await verifyNaming(await signedBy([31, 32]), withDirectory);
		expect(v.named && v.signers.sort()).toEqual(['r1', 'r2']);
	});
});

describe('the reader recomputes rather than trusting', () => {
	/**
	 * THE SUBSTITUTION ATTACK. A compelled edge serves a genuine bundle beside
	 * altered fields. The hash is recomputed from the fields about to be RENDERED,
	 * so any change to any covered field breaks it — including changing only the
	 * name, which is the whole point.
	 */
	it('refuses when any covered field was altered after signing', async () => {
		const alterations: Partial<NamingRecord>[] = [
			{ official_name: 'Someone Else' },
			{ official_badge: 'BADGE-000' },
			{ station_code: 'PS-DL-9999' },
			{ incident_ref: 'inc_other' },
			{ documentary_anchor_sha256: 'd'.repeat(64) },
			{ corroboration_count: 99 },
			{ rank_band: 'commissioner_band' },
			{ right_of_reply_ref: 'ror_none' }
		];
		for (const change of alterations) {
			const signed = await signedBy([31, 32]);
			const tampered: SignedRecord = { ...signed, record: { ...signed.record, ...change } };
			expect(await verifyNaming(tampered, withDirectory), JSON.stringify(change)).toEqual({
				named: false,
				reason: 'hash_mismatch'
			});
		}
	});

	/**
	 * The name cannot be moved onto another record's bundle, because the hash covers
	 * the identifier and the incident anchor TOGETHER. Reviewers sign a name bound to
	 * an incident, never a name.
	 */
	it('refuses a bundle borrowed from a different record', async () => {
		const other = await signedBy([31, 32], {
			...RECORD,
			id: 'acct_other',
			incident_ref: 'inc_zzz'
		});
		const borrowed: SignedRecord = { ...other, record: RECORD };
		expect(await verifyNaming(borrowed, withDirectory)).toEqual({
			named: false,
			reason: 'hash_mismatch'
		});
	});

	/** A server-claimed hash is not evidence of anything. */
	it('refuses when the claimed hash does not match the record', async () => {
		const signed = await signedBy([31, 32]);
		expect(await verifyNaming({ ...signed, record_hash: 'f'.repeat(64) }, withDirectory)).toEqual({
			named: false,
			reason: 'hash_mismatch'
		});
	});
});

describe('the quorum is m-of-n, both halves', () => {
	it('refuses one signature', async () => {
		expect(await verifyNaming(await signedBy([31]), withDirectory)).toEqual({
			named: false,
			reason: 'no_quorum'
		});
	});

	/**
	 * THE n FLOOR, which a signature count alone does not give. A directory holding
	 * exactly two reviewer keys satisfies m while handing one compromised reviewer
	 * half the quorum. The same bundle names with three keys and refuses with two.
	 */
	it('refuses when the directory holds fewer than three eligible keys', async () => {
		const signed = await signedBy([31, 32]);
		expect(NAMING_MIN_KEYS).toBeGreaterThanOrEqual(3);
		expect((await verifyNaming(signed, withDirectory)).named).toBe(true);
		expect(await verifyNaming(signed, { directory: [entry('r1', 31), entry('r2', 32)] })).toEqual({
			named: false,
			reason: 'no_quorum'
		});
	});

	it('refuses a signature from a revoked reviewer', async () => {
		const signed = await signedBy([31, 32]);
		expect(
			await verifyNaming(signed, {
				directory: DIRECTORY,
				revocations: [{ key_id: 'r2', revoked_at_epoch: EPOCH }]
			})
		).toEqual({ named: false, reason: 'no_quorum' });
	});

	/**
	 * A key bound to a different role does not count. Otherwise a marshal or a zone
	 * publisher could contribute to naming a person, which is a different decision
	 * with a different bar.
	 */
	it('refuses signatures from keys bound to another role', async () => {
		const wrongRole = [
			entry('r1', 31, { role: 'marshal' }),
			entry('r2', 32, { role: 'marshal' }),
			entry('r3', 33, { role: 'marshal' })
		];
		expect(await verifyNaming(await signedBy([31, 32]), { directory: wrongRole })).toEqual({
			named: false,
			reason: 'no_quorum'
		});
	});

	/** One reviewer cannot sign twice into a quorum of two. */
	it('refuses the same key presented twice', async () => {
		const hash = await namingRecordHash(RECORD);
		const sig = b64(sign(SIG_CONTEXT.namingRecord, hexToBytes(hash), keypair(31).priv));
		const doubled: SignedRecord = {
			record: RECORD,
			record_hash: hash,
			signatures: [
				{ key_id: 'r1', sig },
				{ key_id: 'r1', sig }
			]
		};
		expect(await verifyNaming(doubled, withDirectory)).toEqual({
			named: false,
			reason: 'no_quorum'
		});
		expect(NAMING_REQUIRED).toBe(2);
	});

	it('refuses a one-byte-tampered signature', async () => {
		const signed = await signedBy([31, 32]);
		const raw = unb64(signed.signatures[1]!.sig);
		raw[0] = (raw[0] ?? 0) ^ 0xff;
		const tampered: SignedRecord = {
			...signed,
			signatures: [signed.signatures[0]!, { key_id: 'r2', sig: b64(raw) }]
		};
		expect(await verifyNaming(tampered, withDirectory)).toEqual({
			named: false,
			reason: 'no_quorum'
		});
	});

	/**
	 * CROSS-PROTOCOL CONFUSION. A signature made for another protocol over the same
	 * bytes must not count here. domainSeparate() length-prefixes a context tag into
	 * the signed message, so a marshal-signal signature cannot be replayed as a
	 * naming approval even though both cover a 32-byte hash.
	 */
	it('refuses a signature made under a different context tag', async () => {
		const hash = await namingRecordHash(RECORD);
		const crossed: SignedRecord = {
			record: RECORD,
			record_hash: hash,
			signatures: [31, 32].map((seed, i) => ({
				key_id: `r${i + 1}`,
				// Signed under marshalSignal, presented as a naming approval.
				sig: b64(sign(SIG_CONTEXT.marshalSignal, hexToBytes(hash), keypair(seed).priv))
			}))
		};
		expect(await verifyNaming(crossed, withDirectory)).toEqual({
			named: false,
			reason: 'no_quorum'
		});
	});
});

describe('failures are distinguishable, and none of them throws', () => {
	/**
	 * A record with no identifier is 'nothing_to_name', NOT 'no_quorum'. Collapsing
	 * them would make an ordinary institutional record read as one where a name is
	 * being withheld from the reader, which is a different and alarming claim.
	 */
	it('separates "there is no name" from "the name did not verify"', async () => {
		const anonymous = { ...RECORD, official_name: null, official_badge: null };
		const signed = await signedBy([31, 32], anonymous);
		expect(await verifyNaming(signed, withDirectory)).toEqual({
			named: false,
			reason: 'nothing_to_name'
		});
	});

	it('reports malformed input as malformed rather than throwing', async () => {
		const bad: unknown[] = [
			null,
			'x',
			{},
			{ record: RECORD },
			{ record: RECORD, record_hash: 1, signatures: [] },
			{ record: RECORD, record_hash: 'a'.repeat(64), signatures: 'no' },
			{ record: RECORD, record_hash: 'a'.repeat(64), signatures: [{ key_id: 'r1' }] },
			{
				record: { ...RECORD, corroboration_count: 'four' },
				record_hash: 'a'.repeat(64),
				signatures: []
			}
		];
		for (const b of bad) {
			const v = await verifyNaming(b as SignedRecord, withDirectory);
			expect(v, JSON.stringify(b)?.slice(0, 60)).toEqual({ named: false, reason: 'malformed' });
		}
	});

	/**
	 * An extra field is malformed, not ignored. It is a field the signer's hash did
	 * not cover, and — worse — a field somebody added to render without deciding it
	 * was safe to render. On this object that field is a home address.
	 */
	it('refuses a record carrying a field nobody signed', async () => {
		const signed = await signedBy([31, 32]);
		const extra = {
			...signed,
			record: { ...signed.record, home_address: '12 Some Street' }
		} as unknown as SignedRecord;
		expect(await verifyNaming(extra, withDirectory)).toEqual({
			named: false,
			reason: 'malformed'
		});
	});

	/** A render path that throws is a blank screen, which is worse than the fallback. */
	it('never throws, whatever it is handed', async () => {
		for (const b of [undefined, NaN, [], () => {}, Symbol('x')]) {
			await expect(verifyNaming(b as unknown as SignedRecord, withDirectory)).resolves.toEqual({
				named: false,
				reason: 'malformed'
			});
		}
	});
});

describe('the institutional view is never individually resolvable', () => {
	/**
	 * §15: a badge number or a specific name is INDIVIDUAL naming, not
	 * institutional. The fallback view must therefore carry neither, or a failed
	 * verification would leak exactly what it withheld.
	 */
	it('carries no name and no badge', () => {
		const view = institutionalView(RECORD);
		expect(JSON.stringify(view)).not.toContain('Officer On Duty');
		expect(JSON.stringify(view)).not.toContain('BADGE-771');
		expect(Object.keys(view).sort()).toEqual([
			'corroboration_count',
			'incident_ref',
			'rank_band',
			'region_bucket',
			'shift_bucket',
			'station_code',
			'unit_code'
		]);
	});

	/** It is a rank BAND and a shift BUCKET, never a rank and a time. */
	it('exposes only coarse institutional fields', () => {
		for (const key of Object.keys(institutionalView(RECORD)))
			expect(key).not.toMatch(/name|badge|photo|plate|phone|address|home|family/i);
	});
});
