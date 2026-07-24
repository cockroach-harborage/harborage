/**
 * NoticeLog DO (ARCHITECTURE §3.2, §4.2). The single, strongly-consistent writer
 * of the official-notice append-only hash chain: appends are serialized through
 * one DO so the chain can never fork. It keeps the chain in its own SQLite for
 * integrity and MIRRORS the notice content + chain to D1 (the public read model
 * the api serves). SQLite here holds PUBLIC-BY-DESIGN, non-personal notice data
 * only — classified SQLITE_OK in gate-memory-only.
 *
 * The DO does not decide trust: the console handler verifies the m-of-n
 * signatures against the signed key directory (packages/crypto) BEFORE calling
 * append. The DO owns chain correctness, not authorization.
 */
import { DurableObject } from 'cloudflare:workers';
import { noticeChainEntry, NOTICE_CHAIN_ROOT } from '@harborage/crypto/notice';

const CHECKPOINT_EVERY = 64;

/** The verified notice the console hands to the log (content + signatures). */
export interface AppendNotice {
	id: string;
	epoch: number;
	notice_type: string;
	title_i18n: string; // JSON string
	body_i18n: string; // JSON string
	area: string | null;
	payload_hash: string; // hex
	signature_set: string; // JSON string
	signer_key_ids: string; // JSON string
	published_at: string;
	supersedes: string | null;
}

export type ChainRow = {
	[column: string]: SqlStorageValue;
	seq: number;
	notice_id: string;
	prev_hash: string;
	entry_hash: string;
	payload_hash: string;
};

export interface ChainStatus {
	count: number;
	head: string; // head entry hash (or the zero root when empty)
	lastCheckpointSeq: number | null;
}

interface Env {
	FLAGS: KVNamespace;
	DB: D1Database;
}

export class NoticeLog extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS chain (
				seq INTEGER PRIMARY KEY,
				notice_id TEXT NOT NULL UNIQUE,
				prev_hash TEXT NOT NULL,
				entry_hash TEXT NOT NULL,
				payload_hash TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS checkpoints (
				seq INTEGER PRIMARY KEY,
				entry_hash TEXT NOT NULL,
				created_at TEXT NOT NULL
			);
		`);
	}

	private head(): { seq: number; entry_hash: string } | null {
		return (
			this.ctx.storage.sql
				.exec<ChainRow>('SELECT seq, entry_hash FROM chain ORDER BY seq DESC LIMIT 1')
				.toArray()[0] ?? null
		);
	}

	status(): ChainStatus {
		const head = this.head();
		const cp = this.ctx.storage.sql
			.exec<{ seq: number }>('SELECT seq FROM checkpoints ORDER BY seq DESC LIMIT 1')
			.toArray()[0];
		return {
			count: head ? head.seq + 1 : 0,
			head: head?.entry_hash ?? NOTICE_CHAIN_ROOT,
			lastCheckpointSeq: cp?.seq ?? null
		};
	}

	/**
	 * Append a verified notice. Computes the chain link, records it in the DO
	 * (strongly consistent), then mirrors the notice + chain row to D1 for the
	 * public read path. Rejects a duplicate id. Returns the new chain link.
	 */
	async append(n: AppendNotice): Promise<{ seq: number; prev_hash: string; entry_hash: string }> {
		const dup = this.ctx.storage.sql
			.exec<ChainRow>('SELECT seq FROM chain WHERE notice_id = ?', n.id)
			.toArray()[0];
		if (dup) throw new Error('notice id already appended');

		const prev = this.head();
		const seq = prev ? prev.seq + 1 : 0;
		const prevHash = prev?.entry_hash ?? NOTICE_CHAIN_ROOT;
		const entryHash = noticeChainEntry(prevHash, n.payload_hash);

		this.ctx.storage.sql.exec(
			'INSERT INTO chain (seq, notice_id, prev_hash, entry_hash, payload_hash) VALUES (?, ?, ?, ?, ?)',
			seq,
			n.id,
			prevHash,
			entryHash,
			n.payload_hash
		);

		const now = new Date().toISOString();
		if ((seq + 1) % CHECKPOINT_EVERY === 0)
			this.ctx.storage.sql.exec(
				'INSERT INTO checkpoints (seq, entry_hash, created_at) VALUES (?, ?, ?)',
				seq,
				entryHash,
				now
			);

		// Mirror to D1 (the public read model). The DO chain is the source of truth;
		// D1 is reconciled from it if a mirror write lags.
		await this.env.DB.batch([
			this.env.DB.prepare(
				`INSERT INTO notices
				 (id, epoch, notice_type, title_i18n, body_i18n, area, payload_hash, signature_set, signer_key_ids, published_at, supersedes)
				 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`
			).bind(
				n.id,
				n.epoch,
				n.notice_type,
				n.title_i18n,
				n.body_i18n,
				n.area,
				n.payload_hash,
				n.signature_set,
				n.signer_key_ids,
				n.published_at,
				n.supersedes
			),
			this.env.DB.prepare(
				'INSERT INTO notice_chain (seq, notice_id, prev_hash, entry_hash) VALUES (?1,?2,?3,?4)'
			).bind(seq, n.id, prevHash, entryHash)
		]);

		if (n.supersedes)
			await this.env.DB.prepare('UPDATE notices SET superseded_by = ?1 WHERE id = ?2')
				.bind(n.id, n.supersedes)
				.run();

		return { seq, prev_hash: prevHash, entry_hash: entryHash };
	}
}
