/**
 * Official-notice publish + list for the console (ARCHITECTURE §4.2, §5.5; PRD
 * §4.2). The console does NOT compose or sign: an admin uploads a notice bundle
 * already signed offline by the m-of-n role keys. The server re-verifies the
 * signatures against the signed key directory (packages/crypto), and only a
 * valid quorum is appended to the NoticeLog chain. The console holds no private
 * keys. Because the key directory ships empty until the ceremony, publish fails
 * closed by construction.
 */
import {
	verifyNotice,
	noticePayloadHashHex,
	revocationListFresh,
	type NoticePayload,
	type NoticeSignature,
	type KeyDirectoryEntry,
	type RevocationEntry
} from '@harborage/crypto/notice';
import type { ConsoleEnv } from '@harborage/worker-lib/types';

export interface NoticeSummary {
	id: string;
	notice_type: string;
	epoch: number;
	published_at: string;
	superseded_by: string | null;
}

interface NoticeLogStub {
	append(n: {
		id: string;
		epoch: number;
		notice_type: string;
		title_i18n: string;
		body_i18n: string;
		area: string | null;
		payload_hash: string;
		signature_set: string;
		signer_key_ids: string;
		published_at: string;
		supersedes: string | null;
	}): Promise<{ seq: number; prev_hash: string; entry_hash: string }>;
	status(): Promise<{ count: number; head: string; lastCheckpointSeq: number | null }>;
}

function noticeLogStub(env: ConsoleEnv): NoticeLogStub {
	const ns = env.NOTICE_LOG;
	return ns.get(ns.idFromName('global')) as unknown as NoticeLogStub;
}

export interface PublishResult {
	ok: boolean;
	message: string;
	seq?: number;
}

interface Bundle {
	payload: NoticePayload;
	signatures: NoticeSignature[];
}

function parseBundle(raw: string): Bundle | null {
	try {
		const b = JSON.parse(raw) as Bundle;
		if (!b || typeof b.payload !== 'object' || !Array.isArray(b.signatures)) return null;
		if (typeof b.payload.id !== 'string' || typeof b.payload.notice_type !== 'string') return null;
		return b;
	} catch {
		return null;
	}
}

async function loadDirectory(env: ConsoleEnv): Promise<KeyDirectoryEntry[]> {
	// Current directory = rows at the max directory_epoch (versioned as a unit).
	const { results } = await env.DB.prepare(
		`SELECT key_id, public_key, role, valid_from_epoch, valid_to_epoch FROM key_directory
		 WHERE directory_epoch = (SELECT MAX(directory_epoch) FROM key_directory)`
	).all<KeyDirectoryEntry>();
	return results ?? [];
}

async function loadRevocations(
	env: ConsoleEnv
): Promise<{ entries: RevocationEntry[]; listEpoch: number; minEpoch: number }> {
	const { results } = await env.DB.prepare(
		`SELECT key_id, revoked_at_epoch, list_epoch, min_revocation_epoch FROM revocation_list
		 WHERE list_epoch = (SELECT MAX(list_epoch) FROM revocation_list)`
	).all<RevocationEntry & { list_epoch: number; min_revocation_epoch: number }>();
	const rows = results ?? [];
	return {
		entries: rows.map((r) => ({ key_id: r.key_id, revoked_at_epoch: r.revoked_at_epoch })),
		listEpoch: rows[0]?.list_epoch ?? 0,
		minEpoch: rows[0]?.min_revocation_epoch ?? 0
	};
}

/** Verify a signed notice bundle and, only if a valid quorum, append it. */
export async function publishNotice(env: ConsoleEnv, rawBundle: string): Promise<PublishResult> {
	const bundle = parseBundle(rawBundle);
	if (!bundle) return { ok: false, message: 'Bundle is not valid JSON or is missing fields.' };

	const directory = await loadDirectory(env);
	const { entries: revocations, listEpoch, minEpoch } = await loadRevocations(env);

	// Freshness floor: a rolled-back revocation list is refused.
	if (revocations.length > 0 && !revocationListFresh(listEpoch, minEpoch))
		return { ok: false, message: 'Revocation list is stale (freshness floor).' };

	const payloadHash = noticePayloadHashHex(bundle.payload);
	const result = verifyNotice(
		bundle.payload,
		bundle.signatures,
		payloadHash,
		directory,
		revocations
	);
	if (!result.valid)
		return {
			ok: false,
			message:
				directory.length === 0
					? 'No key directory yet. Nothing can be published until the offline key ceremony provides role keys.'
					: `Not enough valid signatures: ${result.validSigners.length} of ${result.required} required.`
		};

	const p = bundle.payload;
	try {
		const link = await noticeLogStub(env).append({
			id: p.id,
			epoch: p.epoch,
			notice_type: p.notice_type,
			title_i18n: JSON.stringify(p.title_i18n),
			body_i18n: JSON.stringify(p.body_i18n),
			area: p.area ?? null,
			payload_hash: payloadHash,
			signature_set: JSON.stringify(bundle.signatures),
			signer_key_ids: JSON.stringify(result.validSigners),
			published_at: p.published_at,
			supersedes: p.supersedes ?? null
		});
		return {
			ok: true,
			message: `Published notice ${p.id} at chain position ${link.seq}.`,
			seq: link.seq
		};
	} catch (e) {
		return { ok: false, message: e instanceof Error ? e.message : 'append failed' };
	}
}

/** Recent notices for the console list (public-plaintext read model). */
export async function listNotices(env: ConsoleEnv, limit = 50): Promise<NoticeSummary[]> {
	const { results } = await env.DB.prepare(
		`SELECT id, notice_type, epoch, published_at, superseded_by FROM notices
		 ORDER BY published_at DESC LIMIT ?1`
	)
		.bind(limit)
		.all<NoticeSummary>();
	return results ?? [];
}

export async function chainStatus(env: ConsoleEnv) {
	return noticeLogStub(env).status();
}
