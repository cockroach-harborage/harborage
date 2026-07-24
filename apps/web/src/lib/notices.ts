/**
 * Public official-notice loader (PRD §4.2; ARCHITECTURE §4.2, §5.5). Notices are
 * served from the api (not precached by the SW), so the app caches the last
 * fetched set in IndexedDB and renders it offline with a STALE badge, never dark
 * (ARCHITECTURE §6.5 fail-to-stale).
 *
 * Trust is the signature, not who served it: a notice is only shown as verified
 * when its m-of-n signatures verify against an ON-DEVICE trusted key directory.
 * That directory arrives inside a signed knowledge pack after the offline key
 * ceremony; until then there is no trusted directory on device, so every notice
 * is shown honestly as NOT verified, and directive/operational notices always
 * carry the hard "confirm independently" interstitial.
 */
import { openDB, type IDBPDatabase } from 'idb';
import {
	verifyNotice,
	type KeyDirectoryEntry,
	type RevocationEntry,
	type NoticePayload,
	type NoticeSignature
} from '@harborage/crypto/notice';
import { getLocale } from '$lib/paraglide/runtime';

export interface PublicNotice {
	id: string;
	epoch: number;
	notice_type: string;
	title_i18n: string; // JSON string {en, hi}
	body_i18n: string; // JSON string {en, hi}
	area: string | null;
	payload_hash: string;
	signature_set: string; // JSON string [{key_id, sig}]
	signer_key_ids: string;
	published_at: string;
	supersedes: string | null;
	superseded_by: string | null;
}

export interface NoticesResult {
	published: boolean;
	notices: PublicNotice[];
	stale: boolean;
}

/**
 * Directive / operational classes (ARCHITECTURE §15): real-time, fast-travelling,
 * highest-harm-if-false. Always carry the interstitial, never presented as
 * act-on-this-now regardless of verification.
 */
const DIRECTIVE_TYPES = new Set(['safety_directive', 'detention_alert', 'logistics']);

export function isDirective(noticeType: string): boolean {
	return DIRECTIVE_TYPES.has(noticeType);
}

function pick(json: string): string {
	try {
		const obj = JSON.parse(json) as Record<string, string>;
		return obj[getLocale()] ?? obj.en ?? Object.values(obj)[0] ?? '';
	} catch {
		return '';
	}
}

export function noticeTitle(n: PublicNotice): string {
	return pick(n.title_i18n);
}
export function noticeBody(n: PublicNotice): string {
	return pick(n.body_i18n);
}

/**
 * Verify a notice against an on-device trusted directory. Returns false when no
 * trusted directory is present (the M1 state), so nothing is shown as verified
 * until the ceremony ships a signed directory.
 */
export function noticeVerified(
	n: PublicNotice,
	directory: KeyDirectoryEntry[],
	revocations: RevocationEntry[]
): boolean {
	if (directory.length === 0) return false;
	try {
		const payload = {
			id: n.id,
			epoch: n.epoch,
			notice_type: n.notice_type,
			title_i18n: JSON.parse(n.title_i18n),
			body_i18n: JSON.parse(n.body_i18n),
			area: n.area ?? undefined,
			published_at: n.published_at,
			supersedes: n.supersedes ?? undefined
		} as NoticePayload;
		const signatures = JSON.parse(n.signature_set) as NoticeSignature[];
		return verifyNotice(payload, signatures, n.payload_hash, directory, revocations).valid;
	} catch {
		return false;
	}
}

const DB_NAME = 'harborage-notices';
const STORE = 'cache';
const KEY = 'latest';

let dbP: Promise<IDBPDatabase> | null = null;
function db(): Promise<IDBPDatabase> {
	if (!dbP)
		dbP = openDB(DB_NAME, 1, {
			upgrade(d) {
				d.createObjectStore(STORE);
			}
		});
	return dbP;
}

async function cacheGet(): Promise<PublicNotice[] | null> {
	try {
		return ((await (await db()).get(STORE, KEY)) as PublicNotice[] | undefined) ?? null;
	} catch {
		return null;
	}
}
async function cachePut(notices: PublicNotice[]): Promise<void> {
	try {
		await (await db()).put(STORE, notices, KEY);
	} catch {
		/* private mode / no idb: caching is best-effort */
	}
}

/**
 * Load notices: try the network, cache on success, fall back to the last cached
 * set (STALE) when offline or on error. `published` reflects the flag; an empty
 * published list is the normal M1 state.
 */
export async function loadNotices(fetchFn: typeof fetch = fetch): Promise<NoticesResult> {
	try {
		const res = await fetchFn('/api/notices');
		if (res.ok) {
			const data = (await res.json()) as { published?: boolean; notices?: PublicNotice[] };
			const notices = data.notices ?? [];
			if (data.published) await cachePut(notices);
			return { published: data.published === true, notices, stale: false };
		}
	} catch {
		/* fall through to cache */
	}
	const cached = await cacheGet();
	if (cached) return { published: true, notices: cached, stale: true };
	return { published: false, notices: [], stale: false };
}
