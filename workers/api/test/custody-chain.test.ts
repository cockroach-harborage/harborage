/**
 * The custody ledger (ARCHITECTURE §7.2, §16).
 *
 * Three properties carry the weight: altering any earlier record breaks every
 * later hash; a lone entry is never timestamped by a checkpoint; and a proof
 * cannot be forged by presenting an internal node as a leaf.
 */
import { describe, expect, it } from 'vitest';
import { ACTOR_BANDS, CUSTODY_EVENTS, CustodyChain } from '../src/do/CustodyChain.ts';

const ANCHOR = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const NOW = 1_700_000_000_000;

/** Minimal in-memory stand-in for the DO SQLite + alarm surface. */
function makeCtx() {
	const tables = new Map<string, Record<string, unknown>[]>();
	let alarm: number | null = null;
	const seqs = new Map<string, number>();

	function run<T>(query: string, ...args: unknown[]): T[] {
		const sql = query.trim();
		if (/^CREATE/i.test(sql)) {
			for (const m of sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/gi)) {
				if (!tables.has(m[1]!)) tables.set(m[1]!, []);
				if (!seqs.has(m[1]!)) seqs.set(m[1]!, 0);
			}
			return [];
		}
		if (/^INSERT INTO custody_log/i.test(sql)) {
			const rows = tables.get('custody_log')!;
			const seq = (seqs.get('custody_log') ?? 0) + 1;
			seqs.set('custody_log', seq);
			rows.push({
				seq,
				anchor: args[0],
				event: args[1],
				actor_band: args[2],
				detail: args[3],
				at_bucket: args[4],
				prev_hash: args[5],
				record_hash: args[6],
				ready_ms: args[7],
				checkpoint_seq: null
			});
			return [];
		}
		if (/^INSERT INTO checkpoints/i.test(sql)) {
			const rows = tables.get('checkpoints')!;
			const seq = (seqs.get('checkpoints') ?? 0) + 1;
			seqs.set('checkpoints', seq);
			rows.push({
				seq,
				root: args[0],
				leaf_count: args[1],
				first_seq: args[2],
				last_seq: args[3],
				at_bucket: args[4]
			});
			return [];
		}
		if (/^UPDATE custody_log SET checkpoint_seq/i.test(sql)) {
			for (const row of tables.get('custody_log')!) {
				if (row.seq === args[1]) row.checkpoint_seq = args[0];
			}
			return [];
		}
		if (/FROM custody_log ORDER BY seq DESC LIMIT 1/i.test(sql)) {
			const rows = [...tables.get('custody_log')!].sort((a, b) => (b.seq as number) - (a.seq as number));
			return (rows[0] ? [rows[0]] : []) as T[];
		}
		if (/SELECT MIN\(ready_ms\)/i.test(sql)) {
			const open = tables.get('custody_log')!.filter((r) => r.checkpoint_seq === null);
			const oldest = open.length ? Math.min(...open.map((r) => r.ready_ms as number)) : null;
			return [{ oldest, next_ready: oldest }] as T[];
		}
		if (/FROM custody_log WHERE checkpoint_seq IS NULL ORDER BY seq/i.test(sql)) {
			return tables
				.get('custody_log')!
				.filter((r) => r.checkpoint_seq === null)
				.sort((a, b) => (a.seq as number) - (b.seq as number))
				.slice(0, args[0] as number) as T[];
		}
		if (/FROM custody_log WHERE checkpoint_seq = /i.test(sql)) {
			return tables
				.get('custody_log')!
				.filter((r) => r.checkpoint_seq === args[0])
				.sort((a, b) => (a.seq as number) - (b.seq as number)) as T[];
		}
		if (/FROM custody_log WHERE seq = /i.test(sql)) {
			return tables.get('custody_log')!.filter((r) => r.seq === args[0]) as T[];
		}
		if (/FROM custody_log WHERE anchor = /i.test(sql)) {
			return tables
				.get('custody_log')!
				.filter((r) => r.anchor === args[0] && (r.seq as number) > (args[1] as number))
				.sort((a, b) => (a.seq as number) - (b.seq as number)) as T[];
		}
		if (/FROM checkpoints ORDER BY seq DESC LIMIT 1/i.test(sql)) {
			const rows = [...tables.get('checkpoints')!].sort((a, b) => (b.seq as number) - (a.seq as number));
			return (rows[0] ? [rows[0]] : []) as T[];
		}
		if (/FROM checkpoints WHERE seq = /i.test(sql)) {
			return tables.get('checkpoints')!.filter((r) => r.seq === args[0]) as T[];
		}
		throw new Error(`unhandled query: ${sql.slice(0, 70)}`);
	}

	return {
		tables,
		getAlarmValue: () => alarm,
		ctx: {
			storage: {
				sql: {
					// Eager, like the real thing. Deferring to toArray() would mean the
					// constructor's CREATE TABLE never runs, because nothing reads it.
					exec: <T>(q: string, ...a: unknown[]) => {
						const rows = run<T>(q, ...a);
						return { toArray: () => rows };
					}
				},
				getAlarm: async () => alarm,
				setAlarm: async (t: number) => {
					alarm = t;
				}
			}
		} as unknown as DurableObjectState
	};
}

function chain() {
	const harness = makeCtx();
	return { harness, do_: new CustodyChain(harness.ctx, {}) };
}

const rec = (over: Partial<Parameters<CustodyChain['append']>[0]> = {}) => ({
	event: 'ingest' as const,
	anchor: ANCHOR,
	actorBand: 'system' as const,
	detail: 'queued',
	atBucket: '2026-07-25',
	...over
});

describe('the hash chain', () => {
	it('chains each record to the previous one, genesis included', async () => {
		const { do_ } = chain();
		const first = await do_.append(rec(), NOW);
		expect(first.prevHash).toBe('00'.repeat(32));
		const second = await do_.append(rec({ event: 'redact' }), NOW);
		expect(second.prevHash).toBe(first.recordHash);
	});

	it('changes every later record hash when an earlier record is altered', async () => {
		// The whole point of a hash chain. Recompute the same sequence with one
		// earlier field changed and the later hashes must not match.
		const a = chain();
		await a.do_.append(rec({ detail: 'queued' }), NOW);
		const aSecond = await a.do_.append(rec({ event: 'redact' }), NOW);

		const b = chain();
		await b.do_.append(rec({ detail: 'tampered' }), NOW);
		const bSecond = await b.do_.append(rec({ event: 'redact' }), NOW);

		expect(bSecond.recordHash).not.toBe(aSecond.recordHash);
	});

	it('accepts only the eight custody events', async () => {
		const { do_ } = chain();
		expect(CUSTODY_EVENTS).toHaveLength(8);
		for (const event of CUSTODY_EVENTS) {
			await expect(do_.append(rec({ event }), NOW)).resolves.toBeDefined();
		}
		await expect(
			do_.append(rec({ event: 'unpublish' as never }), NOW)
		).rejects.toThrow(/unknown custody event/);
	});

	it('accepts only role bands, never an identity', async () => {
		const { do_ } = chain();
		for (const actorBand of ACTOR_BANDS) {
			await expect(do_.append(rec({ actorBand }), NOW)).resolves.toBeDefined();
		}
		await expect(do_.append(rec({ actorBand: 'user-42' as never }), NOW)).rejects.toThrow(
			/unknown actor band/
		);
	});

	it('stores no field that could name a person', async () => {
		const { harness, do_ } = chain();
		await do_.append(rec(), NOW);
		const row = harness.tables.get('custody_log')![0]!;
		expect(Object.keys(row).sort()).toEqual(
			[
				'anchor',
				'at_bucket',
				'actor_band',
				'checkpoint_seq',
				'detail',
				'event',
				'prev_hash',
				'ready_ms',
				'record_hash',
				'seq'
			].sort()
		);
	});

	it('refuses an anchor that is not a digest', async () => {
		const { do_ } = chain();
		await expect(do_.append(rec({ anchor: 'not-a-digest' }), NOW)).rejects.toThrow();
	});

	it('caps the reason code, so free text cannot ride along', async () => {
		const { harness, do_ } = chain();
		await do_.append(rec({ detail: 'x'.repeat(500) }), NOW);
		expect((harness.tables.get('custody_log')![0]!.detail as string).length).toBeLessThanOrEqual(64);
	});
});

describe('checkpoint timing', () => {
	it('holds a lone entry out of a checkpoint until its delay elapses', async () => {
		// §16: an external anchor with a precise time is a deanonymization oracle
		// against a singleton submitter. One entry alone must not close a
		// checkpoint the moment it lands.
		const { do_ } = chain();
		await do_.append(rec(), NOW, () => 0.5);
		expect(await do_.checkpoint(NOW)).toBeNull();
		// Far past any randomized delay.
		expect(await do_.checkpoint(NOW + 48 * 60 * 60_000)).not.toBeNull();
	});

	it('closes a checkpoint on a cohort even though no delay has elapsed', async () => {
		// The COHORT branch on its own. Every entry is given the longest possible
		// randomized delay and the checkpoint is taken one minute later, so the
		// delay branch cannot be what closes it. §16 is an OR: once K submissions
		// share a checkpoint the anchor timestamps none of them, so making a full
		// cohort wait buys nothing.
		const { do_ } = chain();
		for (let i = 0; i < 8; i++) {
			await do_.append(rec({ anchor: i % 2 ? ANCHOR : OTHER }), NOW, () => 0.999);
		}
		const cp = await do_.checkpoint(NOW + 60_000);
		expect(cp).not.toBeNull();
		expect(cp!.leaf_count).toBe(8);
	});

	it('closes a checkpoint for a lone entry once its delay elapses', async () => {
		// The DELAY branch on its own: one entry, far below the cohort threshold.
		const { do_ } = chain();
		await do_.append(rec(), NOW, () => 0);
		const cp = await do_.checkpoint(NOW + 3 * 60 * 60_000);
		expect(cp).not.toBeNull();
		expect(cp!.leaf_count).toBe(1);
	});

	it('does not fold in an entry whose delay has not elapsed alongside one that has', async () => {
		// Below the cohort threshold, so only genuinely-elapsed entries go in. A
		// straggler must not be dragged along by an older sibling.
		const { do_ } = chain();
		await do_.append(rec({ detail: 'old' }), NOW, () => 0);
		await do_.append(rec({ detail: 'new' }), NOW, () => 0.999);
		const cp = await do_.checkpoint(NOW + 3 * 60 * 60_000);
		expect(cp!.leaf_count).toBe(1);
	});

	it('checkpoints nothing when nothing is pending', async () => {
		const { do_ } = chain();
		expect(await do_.checkpoint(NOW)).toBeNull();
	});
});

describe('inclusion proofs', () => {
	async function sha(bytes: Uint8Array): Promise<Uint8Array> {
		return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
	}
	function unhex(s: string): Uint8Array {
		const out = new Uint8Array(s.length / 2);
		for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(s.slice(i * 2, i * 2 + 2), 16);
		return out;
	}
	function hex(b: Uint8Array): string {
		return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
	}
	async function fold(leafRecordHash: string, path: { hash: string; right: boolean }[]) {
		let node = await sha(new Uint8Array([0x00, ...unhex(leafRecordHash)]));
		for (const step of path) {
			const sib = unhex(step.hash);
			node = await sha(
				new Uint8Array(step.right ? [0x01, ...node, ...sib] : [0x01, ...sib, ...node])
			);
		}
		return hex(node);
	}

	async function built() {
		const { do_ } = chain();
		for (let i = 0; i < 8; i++) await do_.append(rec({ detail: `e${i}` }), NOW, () => 0);
		const cp = await do_.checkpoint(NOW + 3 * 60 * 60_000);
		return { do_, cp: cp! };
	}

	it('produces a proof that folds to the stored root', async () => {
		const { do_, cp } = await built();
		for (const seq of [1, 4, 8]) {
			const proof = await do_.inclusionProof(seq);
			expect(proof).not.toBeNull();
			expect(await fold(proof!.leafRecordHash, proof!.path)).toBe(cp.root);
		}
	});

	it('refuses a proof whose sibling order was flipped', async () => {
		const { do_, cp } = await built();
		const proof = (await do_.inclusionProof(3))!;
		const flipped = proof.path.map((s) => ({ ...s, right: !s.right }));
		expect(await fold(proof.leafRecordHash, flipped)).not.toBe(cp.root);
	});

	it('refuses a leaf swapped for another real leaf', async () => {
		const { do_, cp } = await built();
		const mine = (await do_.inclusionProof(3))!;
		const theirs = (await do_.inclusionProof(6))!;
		expect(await fold(theirs.leafRecordHash, mine.path)).not.toBe(cp.root);
	});

	it('domain-separates leaves from internal nodes', async () => {
		// Without the 0x00/0x01 prefix an internal node and a leaf are both "sha256
		// of some bytes", so a forged proof can present an internal node as a leaf.
		const { do_ } = await built();
		const proof = (await do_.inclusionProof(1))!;
		const asLeaf = await sha(new Uint8Array([0x00, ...unhex(proof.leafRecordHash)]));
		const asInternal = await sha(new Uint8Array([0x01, ...unhex(proof.leafRecordHash)]));
		expect(hex(asLeaf)).not.toBe(hex(asInternal));
	});

	it('has no proof for an entry not yet in a checkpoint', async () => {
		const { do_ } = chain();
		await do_.append(rec(), NOW, () => 0.5);
		expect(await do_.inclusionProof(1)).toBeNull();
	});
});

describe('the alarm', () => {
	it('keeps one alarm for the whole chain and only moves it earlier', async () => {
		const { harness, do_ } = chain();
		await do_.append(rec(), NOW, () => 0);
		const first = harness.getAlarmValue();
		expect(first).not.toBeNull();
		// A later-ready entry must not push the wake-up back past one already due.
		await do_.append(rec({ event: 'redact' }), NOW, () => 0.99);
		expect(harness.getAlarmValue()).toBe(first);
	});
});

describe('reading one item back', () => {
	it('returns only the records for the anchor asked for', async () => {
		const { do_ } = chain();
		await do_.append(rec({ anchor: ANCHOR }), NOW);
		await do_.append(rec({ anchor: OTHER }), NOW);
		await do_.append(rec({ anchor: ANCHOR, event: 'redact' }), NOW);
		const rows = do_.slice(ANCHOR);
		expect(rows).toHaveLength(2);
		expect(rows.every((r) => r.anchor === ANCHOR)).toBe(true);
	});
});
