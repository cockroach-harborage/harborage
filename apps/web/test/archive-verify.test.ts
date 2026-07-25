/**
 * The client-side inclusion verifier (ARCHITECTURE §7.2, §16).
 *
 * Its promise is that it trusts nothing we serve, so the tests build proofs
 * INDEPENDENTLY here rather than asking the ledger for one: a bug shared between
 * the ledger and the verifier would otherwise agree with itself.
 */
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '@harborage/crypto/pack';
import {
	canonicalJsonLocal,
	foldInclusionPath,
	recomputeRecordHash,
	verifyInclusion,
	type CustodyLine,
	type PathStep
} from '../src/lib/archive-verify.ts';

const ANCHOR = 'a'.repeat(64);
const PREV = '00'.repeat(32);

function hex(b: Uint8Array): string {
	return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function unhex(s: string): Uint8Array {
	const out = new Uint8Array(s.length / 2);
	for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(s.slice(i * 2, i * 2 + 2), 16);
	return out;
}
async function sha(...parts: Uint8Array[]): Promise<Uint8Array> {
	const len = parts.reduce((n, p) => n + p.length, 0);
	const buf = new Uint8Array(len);
	let at = 0;
	for (const p of parts) {
		buf.set(p, at);
		at += p.length;
	}
	return new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
}

async function makeRecord(detail: string): Promise<CustodyLine> {
	const partial = {
		seq: 1,
		event: 'ingest',
		actorBand: 'system',
		detail,
		atBucket: '2026-07-25',
		anchor: ANCHOR,
		prevHash: PREV
	};
	const canonical = canonicalJson({
		event: partial.event,
		anchor: partial.anchor,
		actorBand: partial.actorBand,
		detail: partial.detail,
		atBucket: partial.atBucket
	});
	const recordHash = hex(await sha(unhex(PREV), new TextEncoder().encode(canonical)));
	return { ...partial, recordHash };
}

/** Build a two-leaf tree independently, with the ledger's domain separation. */
async function twoLeafTree(a: string, b: string) {
	const leafA = await sha(new Uint8Array([0x00]), unhex(a));
	const leafB = await sha(new Uint8Array([0x00]), unhex(b));
	const root = hex(await sha(new Uint8Array([0x01]), leafA, leafB));
	return { root, siblingForA: hex(leafB), siblingForB: hex(leafA) };
}

describe('recomputing the record hash', () => {
	it('agrees with the shared canonical encoder', () => {
		// The verifier inlines canonicalJson so a reader can audit every byte it
		// hashes without following a dependency. That is only safe while the two
		// agree, so this is the test that keeps them in step.
		for (const value of [
			{ b: 1, a: 2 },
			{ nested: { z: [1, 2, { y: null }], a: 'x' } },
			[1, 'two', null],
			'plain',
			42,
			null
		]) {
			expect(canonicalJsonLocal(value)).toBe(canonicalJson(value));
		}
	});

	it('reproduces the hash the ledger would have written', async () => {
		const record = await makeRecord('queued');
		expect(await recomputeRecordHash(record)).toBe(record.recordHash);
	});

	it('changes when any field of the record changes', async () => {
		const record = await makeRecord('queued');
		const tampered = { ...record, detail: 'tampered' };
		expect(await recomputeRecordHash(tampered)).not.toBe(record.recordHash);
	});
});

describe('verifying inclusion', () => {
	it('accepts a proof that folds to the root', async () => {
		const a = await makeRecord('a');
		const b = await makeRecord('b');
		const tree = await twoLeafTree(a.recordHash, b.recordHash);
		const out = await verifyInclusion({
			record: a,
			path: [{ hash: tree.siblingForA, right: true }],
			root: tree.root
		});
		expect(out.ok).toBe(true);
	});

	it('never reports an external anchor, because none exists', async () => {
		const a = await makeRecord('a');
		const b = await makeRecord('b');
		const tree = await twoLeafTree(a.recordHash, b.recordHash);
		const out = await verifyInclusion({
			record: a,
			path: [{ hash: tree.siblingForA, right: true }],
			root: tree.root
		});
		expect(out.ok && out.anchored).toBe(false);
	});

	it('refuses a path whose sibling order was flipped', async () => {
		const a = await makeRecord('a');
		const b = await makeRecord('b');
		const tree = await twoLeafTree(a.recordHash, b.recordHash);
		const out = await verifyInclusion({
			record: a,
			path: [{ hash: tree.siblingForA, right: false }],
			root: tree.root
		});
		expect(out).toEqual({ ok: false, reason: 'path_does_not_reach_root' });
	});

	it('refuses a record whose stated hash does not match its contents', async () => {
		const a = await makeRecord('a');
		const b = await makeRecord('b');
		const tree = await twoLeafTree(a.recordHash, b.recordHash);
		// The classic forgery: keep a real hash and a real path, change the story.
		const lying = { ...a, detail: 'something else entirely' };
		const out = await verifyInclusion({
			record: lying,
			path: [{ hash: tree.siblingForA, right: true }],
			root: tree.root
		});
		expect(out).toEqual({ ok: false, reason: 'record_hash_mismatch' });
	});

	it('refuses a leaf swapped for another real leaf', async () => {
		const a = await makeRecord('a');
		const b = await makeRecord('b');
		const tree = await twoLeafTree(a.recordHash, b.recordHash);
		const out = await verifyInclusion({
			record: b,
			path: [{ hash: tree.siblingForA, right: true }],
			root: tree.root
		});
		expect(out.ok).toBe(false);
	});

	it('refuses a malformed bundle rather than guessing', async () => {
		const a = await makeRecord('a');
		for (const bad of [
			{ record: a, path: [] as PathStep[], root: 'not-a-root' },
			{ record: { ...a, prevHash: 'zz' }, path: [], root: 'f'.repeat(64) },
			{ record: a, path: [{ hash: 'short', right: true }], root: 'f'.repeat(64) }
		]) {
			expect((await verifyInclusion(bad as never)).ok).toBe(false);
		}
	});

	it('folds a single-leaf checkpoint with an empty path', async () => {
		const a = await makeRecord('a');
		const root = hex(await sha(new Uint8Array([0x00]), unhex(a.recordHash)));
		expect(await foldInclusionPath(a.recordHash, [])).toBe(root);
		expect((await verifyInclusion({ record: a, path: [], root })).ok).toBe(true);
	});
});
