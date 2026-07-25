/**
 * CustodyChain DO — the append-only custody ledger (ARCHITECTURE §7.2, §16).
 *
 * `H_i = SHA256(H_{i-1} ‖ canonicalJson(record_i))`, so altering any earlier
 * record changes every later hash. Periodic Merkle checkpoints let a third
 * party verify one record's inclusion without being given the whole ledger.
 *
 * WHAT IS NOT IN A RECORD is the design. No IP, no device, no name, no
 * pseudonym, no precise instant, no coordinates. The actor is a role BAND, and
 * the anchor is the pristine original's digest. A compelled dump of this table
 * yields a sequence of events about files, with nothing that reaches a person.
 *
 * TIMING IS THE SUBTLE LEAK. §16 is explicit that an external anchor with a
 * precise time is a deanonymization oracle against a singleton submitter: if
 * one item enters one checkpoint alone, the anchor timestamps that submission.
 * An entry therefore becomes eligible only once a cohort of at least K exists
 * or a RANDOMIZED delay elapses (a fixed delay is the submission time plus a
 * constant, i.e. the same oracle with an offset). That gate lives in
 * @harborage/worker-lib/archive so the Worker and the client agree on it.
 *
 * THIS CLASS DOES NOT SIGN ANYTHING. packages/crypto/src/signature.ts exposes
 * verification only, deliberately. A signed checkpoint is produced by the
 * offline m-of-n minisign ceremony (RUNBOOK); a signing key reachable from an
 * edge Worker is a key a compelled edge can use. Never add one here.
 */
import { DurableObject } from 'cloudflare:workers';
import { canonicalJson } from '@harborage/crypto/pack';
import {
	CHECKPOINT_COHORT_K,
	checkpointReady,
	randomizedInclusionDelayMs
} from '@harborage/worker-lib/archive';

/**
 * The complete event vocabulary. Closed on purpose: a ledger whose event set
 * can grow silently is a ledger whose meaning drifts, and every reader of an
 * export would have to handle an event it has never seen.
 */
export const CUSTODY_EVENTS = [
	'ingest',
	'redact',
	'admit',
	'probation-clear',
	'lock',
	'replicate',
	'dispute',
	'tombstone'
] as const;
export type CustodyEvent = (typeof CUSTODY_EVENTS)[number];

/**
 * Who acted, at the coarsest granularity that is still useful. A band, never an
 * identity: 'reviewer' says a human with review authority acted, and nothing
 * about which one.
 */
export const ACTOR_BANDS = ['system', 'contributor', 'reviewer', 'operator'] as const;
export type ActorBand = (typeof ACTOR_BANDS)[number];

/** Reason codes are short and bounded; free text beside evidence is a doxx vector. */
const MAX_DETAIL_LEN = 64;
/** A checkpoint closes on whichever comes first. */
const CHECKPOINT_EVERY = 64;
const DAY_MS = 24 * 60 * 60_000;

export interface CustodyRecord {
	event: CustodyEvent;
	/** The pristine original's digest. The only join key this ledger has. */
	anchor: string;
	actorBand: ActorBand;
	detail: string;
	atBucket: string;
}

export interface AppendResult {
	seq: number;
	recordHash: string;
	prevHash: string;
}

interface LogRow {
	[column: string]: SqlStorageValue;
	seq: number;
	anchor: string;
	event: string;
	actor_band: string;
	detail: string;
	at_bucket: string;
	prev_hash: string;
	record_hash: string;
	ready_ms: number;
	checkpoint_seq: number | null;
}

interface CheckpointRow {
	[column: string]: SqlStorageValue;
	seq: number;
	root: string;
	leaf_count: number;
	first_seq: number;
	last_seq: number;
	at_bucket: string;
}

export interface InclusionProof {
	leafRecordHash: string;
	path: { hash: string; right: boolean }[];
	root: string;
	checkpointSeq: number;
}

const GENESIS = '00'.repeat(32);

function hex(bytes: Uint8Array): string {
	let out = '';
	for (const b of bytes) out += b.toString(16).padStart(2, '0');
	return out;
}

function unhex(s: string): Uint8Array {
	const out = new Uint8Array(s.length / 2);
	for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(s.slice(i * 2, i * 2 + 2), 16);
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
 * Domain separation, and it is load-bearing. Without the distinguishing prefix
 * byte an internal node and a leaf are both "SHA256 of 32 or 64 bytes", so a
 * forged proof can present an internal node as though it were a leaf.
 */
async function leafHash(recordHash: string): Promise<Uint8Array> {
	return sha256(new Uint8Array([0x00]), unhex(recordHash));
}

async function internalHash(left: Uint8Array, right: Uint8Array): Promise<Uint8Array> {
	return sha256(new Uint8Array([0x01]), left, right);
}

function dayBucket(nowMs: number): string {
	return new Date(nowMs).toISOString().slice(0, 10);
}

export class CustodyChain extends DurableObject {
	constructor(ctx: DurableObjectState, env: unknown) {
		super(ctx, env as never);
		this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS custody_log (
				seq INTEGER PRIMARY KEY AUTOINCREMENT,
				anchor TEXT NOT NULL,
				event TEXT NOT NULL,
				actor_band TEXT NOT NULL,
				detail TEXT NOT NULL,
				at_bucket TEXT NOT NULL,
				prev_hash TEXT NOT NULL,
				record_hash TEXT NOT NULL,
				ready_ms INTEGER NOT NULL,
				checkpoint_seq INTEGER
			);
			CREATE INDEX IF NOT EXISTS idx_log_anchor ON custody_log (anchor);
			CREATE INDEX IF NOT EXISTS idx_log_checkpoint ON custody_log (checkpoint_seq);
			CREATE INDEX IF NOT EXISTS idx_log_ready ON custody_log (ready_ms);

			CREATE TABLE IF NOT EXISTS checkpoints (
				seq INTEGER PRIMARY KEY AUTOINCREMENT,
				root TEXT NOT NULL,
				leaf_count INTEGER NOT NULL,
				first_seq INTEGER NOT NULL,
				last_seq INTEGER NOT NULL,
				at_bucket TEXT NOT NULL,
				anchor_receipt BLOB
			);
		`);
	}

	/** The most recent record, or null on an empty chain. */
	head(): { seq: number; recordHash: string } | null {
		const row = this.ctx.storage.sql
			.exec<LogRow>('SELECT * FROM custody_log ORDER BY seq DESC LIMIT 1')
			.toArray()[0];
		return row ? { seq: row.seq, recordHash: row.record_hash } : null;
	}

	/** Every record for one anchor, oldest first. */
	slice(anchor: string, fromSeq = 0, limit = 200): LogRow[] {
		return this.ctx.storage.sql
			.exec<LogRow>(
				'SELECT * FROM custody_log WHERE anchor = ?1 AND seq > ?2 ORDER BY seq ASC LIMIT ?3',
				anchor,
				fromSeq,
				limit
			)
			.toArray();
	}

	async append(
		record: CustodyRecord,
		nowMs = Date.now(),
		rand: () => number = Math.random
	): Promise<AppendResult> {
		if (!(CUSTODY_EVENTS as readonly string[]).includes(record.event)) {
			throw new Error(`unknown custody event: ${record.event}`);
		}
		if (!(ACTOR_BANDS as readonly string[]).includes(record.actorBand)) {
			throw new Error(`unknown actor band: ${record.actorBand}`);
		}
		if (!/^[0-9a-f]{64}$/.test(record.anchor)) {
			throw new Error('anchor must be a sha256 hex digest');
		}

		const prev = this.head()?.recordHash ?? GENESIS;
		// canonicalJson, not JSON.stringify: two writers must produce byte-identical
		// input or the chain a verifier recomputes will not match ours.
		const canonical = canonicalJson({
			event: record.event,
			anchor: record.anchor,
			actorBand: record.actorBand,
			detail: record.detail.slice(0, MAX_DETAIL_LEN),
			atBucket: record.atBucket
		});
		const recordHash = hex(await sha256(unhex(prev), new TextEncoder().encode(canonical)));
		const readyMs = nowMs + randomizedInclusionDelayMs(rand);

		this.ctx.storage.sql.exec(
			`INSERT INTO custody_log
				(anchor, event, actor_band, detail, at_bucket, prev_hash, record_hash, ready_ms, checkpoint_seq)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL)`,
			record.anchor,
			record.event,
			record.actorBand,
			record.detail.slice(0, MAX_DETAIL_LEN),
			record.atBucket,
			prev,
			recordHash,
			readyMs
		);
		const seq = this.head()?.seq ?? 0;
		await this.arm(nowMs);
		return { seq, recordHash, prevHash: prev };
	}

	/** Everything not yet folded into a checkpoint, oldest first. */
	private unclosed(): LogRow[] {
		return this.ctx.storage.sql
			.exec<LogRow>(
				'SELECT * FROM custody_log WHERE checkpoint_seq IS NULL ORDER BY seq ASC LIMIT ?1',
				CHECKPOINT_EVERY
			)
			.toArray();
	}

	private oldestPendingMs(nowMs: number): number {
		const row = this.ctx.storage.sql
			.exec<{ oldest: number | null }>(
				'SELECT MIN(ready_ms) AS oldest FROM custody_log WHERE checkpoint_seq IS NULL'
			)
			.toArray()[0];
		return row?.oldest ?? nowMs;
	}

	/**
	 * Close a checkpoint if one is due. Returns null when it is not.
	 *
	 * The cohort gate is what stops a lone submission being timestamped by the
	 * external anchor. It is checked here rather than at append, because a cohort
	 * can form after an entry lands.
	 */
	async checkpoint(nowMs = Date.now()): Promise<CheckpointRow | null> {
		const open = this.unclosed();
		if (open.length === 0) return null;

		// §16 is an OR, not an AND: an entry enters "after it joins a cohort of at
		// least K OR a randomized delay elapses". A first draft filtered by the
		// delay first and then applied the cohort test, which made the cohort test
		// dead code (it could only ever see entries whose delay had already
		// elapsed) AND was stricter than §16, since a full cohort still had to sit
		// out every member's individual delay for no privacy gain: once K
		// submissions share a checkpoint, the anchor timestamps none of them.
		//
		// Sabotaging the cohort branch is what exposed this. The lone-entry test
		// stayed green with the gate deleted, because the delay filter was doing
		// all the work.
		const cohortFormed = open.length >= CHECKPOINT_COHORT_K;
		const eligible = checkpointReady({
			pending: open.length,
			oldestPendingMs: this.oldestPendingMs(nowMs),
			nowMs,
			k: CHECKPOINT_COHORT_K,
			// The wait itself is already baked into ready_ms at append time, so the
			// question here is only whether that moment has arrived.
			maxDelayMs: 0
		});
		if (!eligible) return null;

		const ready = cohortFormed ? open : open.filter((r) => (r.ready_ms as number) <= nowMs);
		if (ready.length === 0) return null;

		let level = await Promise.all(ready.map((r) => leafHash(r.record_hash)));
		while (level.length > 1) {
			const next: Uint8Array[] = [];
			for (let i = 0; i < level.length; i += 2) {
				const left = level[i]!;
				const right = level[i + 1];
				// An odd node is PROMOTED unchanged rather than duplicated. Hashing a
				// node with itself makes a two-leaf tree and a one-leaf tree with a
				// duplicated leaf produce the same root.
				next.push(right ? await internalHash(left, right) : left);
			}
			level = next;
		}
		const root = hex(level[0]!);
		const first = ready[0]!.seq;
		const last = ready[ready.length - 1]!.seq;

		this.ctx.storage.sql.exec(
			'INSERT INTO checkpoints (root, leaf_count, first_seq, last_seq, at_bucket) VALUES (?1, ?2, ?3, ?4, ?5)',
			root,
			ready.length,
			first,
			last,
			dayBucket(nowMs)
		);
		const cpSeq = this.ctx.storage.sql
			.exec<{ seq: number }>('SELECT seq FROM checkpoints ORDER BY seq DESC LIMIT 1')
			.toArray()[0]!.seq;
		for (const row of ready) {
			this.ctx.storage.sql.exec('UPDATE custody_log SET checkpoint_seq = ?1 WHERE seq = ?2', cpSeq, row.seq);
		}
		return this.ctx.storage.sql
			.exec<CheckpointRow>('SELECT * FROM checkpoints WHERE seq = ?1', cpSeq)
			.toArray()[0]!;
	}

	/** A proof a third party can fold to the published root without trusting us. */
	async inclusionProof(seq: number): Promise<InclusionProof | null> {
		const row = this.ctx.storage.sql
			.exec<LogRow>('SELECT * FROM custody_log WHERE seq = ?1', seq)
			.toArray()[0];
		if (!row || row.checkpoint_seq === null) return null;
		const cp = this.ctx.storage.sql
			.exec<CheckpointRow>('SELECT * FROM checkpoints WHERE seq = ?1', row.checkpoint_seq)
			.toArray()[0];
		if (!cp) return null;

		const members = this.ctx.storage.sql
			.exec<LogRow>(
				'SELECT * FROM custody_log WHERE checkpoint_seq = ?1 ORDER BY seq ASC',
				row.checkpoint_seq
			)
			.toArray();
		let index = members.findIndex((m) => m.seq === seq);
		if (index < 0) return null;

		let level = await Promise.all(members.map((m) => leafHash(m.record_hash)));
		const path: { hash: string; right: boolean }[] = [];
		while (level.length > 1) {
			const partner = index % 2 === 0 ? index + 1 : index - 1;
			const sibling = level[partner];
			if (sibling) path.push({ hash: hex(sibling), right: partner > index });
			const next: Uint8Array[] = [];
			for (let i = 0; i < level.length; i += 2) {
				const left = level[i]!;
				const right = level[i + 1];
				next.push(right ? await internalHash(left, right) : left);
			}
			level = next;
			index = Math.floor(index / 2);
		}
		return {
			leafRecordHash: row.record_hash,
			path,
			root: cp.root,
			checkpointSeq: cp.seq
		};
	}

	override async alarm(): Promise<void> {
		await this.checkpoint();
		await this.arm(Date.now());
	}

	/**
	 * ONE alarm for the whole chain, never one per entry. A Durable Object has a
	 * single alarm and each setAlarm() REPLACES the previous one, so a per-entry
	 * design silently loses every earlier wake-up; and each setAlarm() bills as a
	 * row written. Only ever moved earlier, so a trickle of far-future entries
	 * cannot keep pushing the wake-up back past entries already due.
	 */
	private async arm(nowMs: number): Promise<void> {
		const next = this.ctx.storage.sql
			.exec<{ next_ready: number | null }>(
				'SELECT MIN(ready_ms) AS next_ready FROM custody_log WHERE checkpoint_seq IS NULL'
			)
			.toArray()[0]?.next_ready;
		const due = next ?? nowMs + DAY_MS;
		const existing = await this.ctx.storage.getAlarm();
		if (existing === null || due < existing) {
			await this.ctx.storage.setAlarm(Math.max(due, nowMs + 1000));
		}
	}
}
