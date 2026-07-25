/**
 * Every decision the outbox runner makes, as pure functions (ARCHITECTURE §19).
 *
 * Split out for the reason identity-core.ts and derivative-core.ts were:
 * apps/web/vitest.config.ts includes only test/** with no $lib alias and no DOM,
 * so anything unit-tested here must import nothing that touches a browser. The
 * two @harborage/outbox modules imported below are themselves import-pure.
 *
 * The point of the split is not tidiness. "Serial on 2G" and "an item with no
 * receipt is never flushed" are safety properties; putting them inside a loop in
 * the runner makes them invariants nobody re-reads, and putting them here makes
 * them assertions that fail the build when broken.
 */
import { fullJitterDelay, MAX_BACKOFF_MS } from '@harborage/outbox/backoff';
import {
	concurrencyFor,
	type LinkClass,
	type OriginalStatus,
	type OutboxItem
} from '@harborage/outbox/types';

/** The outbox's three-tier link class, distinct from the pipeline's two-tier one. */
export type UploadLink = LinkClass;

/**
 * Map a Network Information reading to the UPLOAD link class.
 *
 * Deliberately not derivative-core's linkClassFrom, and deliberately not a cast.
 * That function answers a different question (encode quality) and collapses 3g
 * and 4g into one 'fast' tier, which §7.5:330 settled for encoding. Reusing it
 * here would put THREE concurrent uploads on 3G, outside the ceiling §19:1273
 * states. The two-tier type is also assignable to the three-tier one, so a stray
 * reuse typechecks silently — hence a named function with its own test.
 */
export function uploadLinkFrom(
	conn: { effectiveType?: string; saveData?: boolean } | null | undefined
): UploadLink {
	if (!conn) return 'slow';
	// Data Saver is an explicit "spend as little as possible" instruction.
	if (conn.saveData === true) return 'slow';
	switch (conn.effectiveType) {
		case '4g':
			return 'fast';
		case '3g':
			return 'medium';
		case '2g':
		case 'slow-2g':
			return 'slow';
		default:
			// Unknown reading, or no Network Information at all. Assume the worst
			// link rather than the best: over-parallelising a 2G phone causes
			// congestion collapse, and under-parallelising a good one costs time.
			return 'slow';
	}
}

export type SkipReason = 'done' | 'cancelled' | 'needs_you' | 'backing_off' | 'expired';

export interface Runnability {
	run: boolean;
	reason?: SkipReason;
}

/**
 * May the runner touch the network for this item right now?
 *
 * `needs_you` is the load-bearing case. POST /api/incidents/register requires a
 * live, single-use Turnstile token, so phase 1 cannot be resumed by a background
 * flush. The three options were: persist the token (single-use, short-lived, and
 * a personhood token sitting on a seized phone is a metadata liability), flush
 * with an empty one (a guaranteed 403 per attempt, burning 2G data and battery
 * while the UI says "Sending"), or refuse. Refusing is also where §19:1247
 * already points: phase 1 is explicitly not a silent immediate default for a
 * high-risk capture. Phases 2 and 3 carry a receipt and a cap-cert, no challenge,
 * so they resume with no human.
 */
export function runnability(item: OutboxItem, now: number): Runnability {
	if (item.state === 'done') return { run: false, reason: 'done' };
	if (item.state === 'cancelled') return { run: false, reason: 'cancelled' };
	if (!item.incidentReceipt) return { run: false, reason: 'needs_you' };
	if (now < item.nextEarliestRetry) return { run: false, reason: 'backing_off' };
	// maxAge bounds RETRYING, not retention. Nothing is deleted and no status
	// changes; the runner just stops picking it up on its own, and the UI moves
	// it to the group that needs a person. Auto-destroying evidence on a timer
	// is the most dangerous thing this feature could do.
	if (now > item.createdAt + item.maxAge) return { run: false, reason: 'expired' };
	return { run: true };
}

/**
 * Choose which items to advance in this pass, and how many may run at once.
 *
 * The concurrency cap lives INSIDE this function rather than in the runner's
 * loop, so "serial on 2G" is a unit-tested fact. Concurrency is across items;
 * parts stay serial within an item (see the note in outbox-runner.ts).
 */
export function selectRunnable(
	items: readonly OutboxItem[],
	now: number,
	link: UploadLink
): OutboxItem[] {
	const runnable = items.filter((item) => runnability(item, now).run);
	runnable.sort((a, b) => {
		// Cheap phase-2 work (a few hundred KB of derivative) ahead of phase-3
		// vault uploads, so a queue holding one large video does not starve every
		// small public copy behind it.
		const aPhase = a.derivative.uploaded ? 1 : 0;
		const bPhase = b.derivative.uploaded ? 1 : 0;
		if (aPhase !== bPhase) return aPhase - bPhase;
		return a.createdAt - b.createdAt;
	});
	return runnable.slice(0, concurrencyFor(link));
}

/** Full-jitter backoff, as an absolute instant to persist on the item. */
export function nextRetryAt(attempts: number, now: number, random: () => number = Math.random): number {
	return now + fullJitterDelay(attempts, random);
}

/** Ceiling re-exported so a caller cannot drift from the engine's bound. */
export const MAX_RETRY_DELAY_MS = MAX_BACKOFF_MS;

/**
 * Spread the start of a flush. This is §9.3 timing decorrelation — a send that
 * fires the instant the app is foregrounded is tightly correlated with the act
 * of opening it — and it doubles as the debounce for visibilitychange, which
 * fires constantly on mobile. A manual "Try now" skips it: the user is already
 * the correlating event, and a delay there just reads as broken.
 */
export const FLUSH_JITTER_MS = 8_000;
export function flushJitterMs(random: () => number = Math.random): number {
	return Math.floor(random() * FLUSH_JITTER_MS);
}

export type CompleteOutcome = 'ok' | 'no_such_upload' | 'invalid_part' | 'retryable';

/**
 * Map a CompleteMultipartUpload status HONESTLY (the #53 fix, extracted so it is
 * directly testable). Only a genuinely gone upload justifies the restart path,
 * which discards the cursor and re-uploads every part from zero.
 */
export function completeStatusOutcome(status: number): CompleteOutcome {
	if (status >= 200 && status < 300) return 'ok';
	if (status === 404 || status === 409) return 'no_such_upload';
	if (status === 400) return 'invalid_part';
	return 'retryable';
}

export type StorageVerdict = 'ok' | 'unknown' | 'not_persisted' | 'tight' | 'insufficient';

export interface StorageEstimate {
	persisted: boolean | null;
	usage?: number | undefined;
	quota?: number | undefined;
	need: number;
}

/** Headroom below which we warn even though the write would succeed today. */
export const STORAGE_TIGHT_MULTIPLE = 3;

export function evaluateStorage(e: StorageEstimate): StorageVerdict {
	const free =
		typeof e.quota === 'number' && typeof e.usage === 'number' ? e.quota - e.usage : null;
	if (free !== null && free < e.need) return 'insufficient';
	if (e.persisted === false) return 'not_persisted';
	if (free === null) return 'unknown';
	if (free < e.need * STORAGE_TIGHT_MULTIPLE) return 'tight';
	return 'ok';
}

/**
 * Storage pressure WARNS and never blocks. A phone that may evict the sealed
 * original is exactly the phone whose owner most needs it sent, and refusing the
 * capture guarantees the loss the warning is trying to prevent (§19:1264).
 */
export function storageBlocks(_verdict: StorageVerdict): false {
	return false;
}

export type ProgressKey =
	| 'outbox_needs_you'
	| 'outbox_step_registered'
	| 'outbox_step_derivative'
	| 'outbox_step_vaulting'
	| 'outbox_step_vaulted'
	| 'outbox_stopped_trying'
	| 'outbox_retry_soon';

export interface ProgressView {
	key: ProgressKey;
	sentMb?: string;
	totalMb?: string;
	custody: OriginalStatus;
}

/** Bytes whose ETag is persisted. Anything else is not yet in the vault. */
export function vaultedBytes(item: OutboxItem): number {
	const cursor = item.original.r2;
	if (!cursor) return 0;
	return Math.min(cursor.parts.length * cursor.partSize, item.original.size);
}

export function formatMb(bytes: number): string {
	return (bytes / 1_048_576).toFixed(1);
}

export function progressFor(item: OutboxItem, now: number): ProgressView {
	const custody = item.originalStatus;
	const verdict = runnability(item, now);
	if (verdict.reason === 'needs_you') return { key: 'outbox_needs_you', custody };
	if (verdict.reason === 'expired') return { key: 'outbox_stopped_trying', custody };
	if (custody === 'vaulted') return { key: 'outbox_step_vaulted', custody };
	if (verdict.reason === 'backing_off') return { key: 'outbox_retry_soon', custody };
	// 'completing' deliberately reports vaulting, not vaulted. originalStatus
	// flips to vaulted only after CompleteMultipartUpload is confirmed (§19:1267),
	// and claiming custody one step early is the kind of overstatement that reads
	// in court as a false chain-of-custody assertion.
	if (item.state === 'uploading' || item.state === 'completing') {
		return {
			key: 'outbox_step_vaulting',
			sentMb: formatMb(vaultedBytes(item)),
			totalMb: formatMb(item.original.size),
			custody
		};
	}
	if (item.derivative.uploaded) return { key: 'outbox_step_derivative', custody };
	return { key: 'outbox_step_registered', custody };
}

/**
 * Has the sealed original gone from this phone without ever reaching the vault?
 *
 * This is the ONLY thing that sets originalStatus to 'lost'. §19:1259 defines
 * lost by a fact — the ledger asserts a pristine original the vault never got
 * and that no longer exists here — which is IndexedDB eviction, a deleted
 * document, or an erase. A clock expiring destroys no bytes, so maxAge must
 * never produce this state.
 */
export function backingBytesMissing(
	item: Pick<OutboxItem, 'originalStatus'>,
	record: { original?: { sealed: { size: number } } | undefined } | undefined
): boolean {
	if (item.originalStatus === 'vaulted' || item.originalStatus === 'none') return false;
	if (!record?.original) return true;
	return record.original.sealed.size === 0;
}
