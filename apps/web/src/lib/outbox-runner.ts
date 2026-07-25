/**
 * Drives the encrypted outbox (ARCHITECTURE §19:1304-1315).
 *
 * The engine in packages/outbox has been complete since M1 and nothing ever
 * drove it: a killed upload persisted its cursor and was never picked back up,
 * and every upload ran serially whatever the link. This is the missing driver.
 *
 * Flush triggers are `online` and `visibilitychange -> visible`, plus a manual
 * "Try now". Background Sync is deliberately NOT registered: it could only ever
 * advance post-receipt items, which the visible flush already covers, and it has
 * no test surface on iOS, where visibilitychange is the only reliable trigger.
 *
 * CONCURRENCY IS ACROSS ITEMS, and parts stay serial within one. §19:1273's
 * "1-2 on 3g, 2-4 on 4g" sits under the multipart heading and literally means
 * parts, but implementing it that way requires redefining what
 * MultipartCursor.nextPart means -- it becomes "highest handed out" and needs an
 * in-flight reconciliation on resume. That is a semantic migration of the one
 * persisted structure anchoring chain of custody, and it breaks the
 * ETag-before-nextPart invariant multipart.ts states and its tests assert. On
 * the link §19 is most emphatic about the answer is 1 either way, and the common
 * queue is several stills rather than one huge video, so bounding concurrent
 * DOCUMENTS lands inside §19's envelope at every tier for none of the risk.
 */
import { IdbOutboxStore, type OutboxItem, type OutboxStore } from '@harborage/outbox';
import { documents, type LocalDocument } from '$lib/documents';
import {
	backingBytesMissing,
	evaluateStorage,
	flushJitterMs,
	nextRetryAt,
	progressFor,
	runnability,
	selectRunnable,
	uploadLinkFrom,
	type ProgressView,
	type StorageVerdict,
	type UploadLink
} from '$lib/outbox-core';
import { advanceRecord, getIntakeStatus, makeOutboxItem, type IntakeStatus } from '$lib/uploads';

export interface RunnerDeps {
	store?: OutboxStore;
	fetchFn?: typeof fetch;
	now?: () => number;
	random?: () => number;
	link?: () => UploadLink;
	sleep?: (ms: number) => Promise<void>;
	/** A person asked for this, so skip the decorrelation delay. */
	manual?: boolean;
	turnstileToken?: string;
}

export interface OutboxRow {
	id: string;
	progress: ProgressView;
	canStop: boolean;
}

export interface FlushSummary {
	advanced: number;
	skipped: number;
	status: 'idle' | 'offline' | 'not_open' | 'done';
}

export interface EnqueueResult {
	item: OutboxItem;
	storage: StorageVerdict;
}

/** Bound on passes per flush, so a persistent failure cannot spin. */
const MAX_PASSES = 20;

let sharedStore: IdbOutboxStore | null = null;
/** Set by the device erase, so a visibilitychange mid-wipe cannot reopen a database. */
let halted = false;
/**
 * Global flush chain. Two flushes must never overlap.
 *
 * The concurrency cap is computed per flush, so a foreground flush racing a
 * manual "Try now" produced TWICE the intended parallelism -- two concurrent
 * uploads on a 2G link, which is precisely the congestion collapse §19:1273
 * exists to prevent. Guarding only the event handler was not enough, because
 * `tryNow` calls the flush directly. Serialising here is the only place that
 * covers every caller.
 */
let chain: Promise<unknown> = Promise.resolve();

function store(deps: RunnerDeps): OutboxStore {
	if (deps.store) return deps.store;
	sharedStore ??= new IdbOutboxStore();
	return sharedStore;
}

function currentUploadLink(): UploadLink {
	const conn = (navigator as unknown as { connection?: { effectiveType?: string; saveData?: boolean } })
		.connection;
	return uploadLinkFrom(conn);
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The outbox database name, which `IdbOutboxStore` owns. */
const OUTBOX_DB = 'harborage-outbox';

/**
 * Has anything ever been queued on this phone?
 *
 * `openDB` CREATES the database, so a reader that opens it unconditionally makes
 * every page load leave storage behind. Two consequences, both worth avoiding: a
 * phone that has never queued anything gets an empty database it never needed,
 * and an erase is immediately followed by the next page load recreating what was
 * just removed. Writers (enqueue) still create it, which is when there is
 * genuinely something to store.
 *
 * Where `databases()` is unavailable we proceed, because refusing to flush would
 * be a far worse failure than creating an empty store.
 */
async function outboxExists(): Promise<boolean> {
	try {
		if (typeof indexedDB.databases !== 'function') return true;
		return (await indexedDB.databases()).some((d) => d.name === OUTBOX_DB);
	} catch {
		return true;
	}
}

/**
 * Ask for durable storage and report the headroom, then queue the row.
 *
 * The verdict WARNS and never blocks: a phone that may evict the sealed original
 * is exactly the phone whose owner most needs it sent, and refusing the capture
 * guarantees the loss the warning is trying to prevent (§19:1264).
 */
export async function enqueue(record: LocalDocument, deps: RunnerDeps = {}): Promise<EnqueueResult> {
	const s = store(deps);
	const item = (await s.get(record.id)) ?? makeOutboxItem(record);
	await s.put(item);

	let persisted: boolean | null = null;
	let usage: number | undefined;
	let quota: number | undefined;
	try {
		if (navigator.storage?.persist) persisted = await navigator.storage.persist();
		if (navigator.storage?.estimate) {
			const est = await navigator.storage.estimate();
			usage = est.usage;
			quota = est.quota;
		}
	} catch {
		// A browser with neither API yields 'unknown', which warns and never blocks.
	}
	return {
		item,
		storage: evaluateStorage({ persisted, usage, quota, need: item.original.size })
	};
}

/** One item, one pass. Persists the outcome on both the row and the document. */
async function advanceOne(
	item: OutboxItem,
	deps: RunnerDeps,
	status: IntakeStatus
): Promise<boolean> {
	const s = store(deps);
	const now = deps.now ?? Date.now;
	const record = await documents.get(item.id);

	// The queue row outlived the bytes it describes: eviction, a deleted
	// document, or an erase. That is §19:1259's spoliation case, and the only
	// thing that ever sets 'lost'.
	if (backingBytesMissing(item, record)) {
		item.originalStatus = 'lost';
		item.state = 'cancelled';
		await s.put(item);
		if (record) {
			record.originalStatus = 'lost';
			await documents.put(record);
		}
		return false;
	}
	if (!record) return false;

	const before = item.attempts;
	const { item: advanced, outcome } = await advanceRecord(item, record, {
		store: s,
		...(deps.fetchFn ? { fetchFn: deps.fetchFn } : {}),
		...(deps.turnstileToken ? { turnstileToken: deps.turnstileToken } : {}),
		status
	});

	if (outcome !== 'sent' || advanced.attempts > before) {
		advanced.nextEarliestRetry = nextRetryAt(advanced.attempts, now(), deps.random);
		await s.put(advanced);
		return false;
	}

	// Custody status belongs on the document, which outlives the queue row and
	// is what the custody chain and any export read (§19:1261).
	record.originalStatus = advanced.originalStatus;
	record.sent = true;
	await documents.put(record);
	if (advanced.state === 'done') await s.delete(advanced.id);
	return true;
}

/**
 * Advance everything the link and the clock allow.
 *
 * Reads the queue FIRST. An empty or wholly-unrunnable queue makes zero network
 * calls, so foregrounding the app does not emit a status beacon on every open.
 */
export function flushOutbox(deps: RunnerDeps = {}): Promise<FlushSummary> {
	const next = chain.then(
		() => runFlush(deps),
		() => runFlush(deps)
	);
	chain = next.catch(() => undefined);
	return next;
}

async function runFlush(deps: RunnerDeps): Promise<FlushSummary> {
	if (halted) return { advanced: 0, skipped: 0, status: 'idle' };
	if (!deps.store && !(await outboxExists())) return { advanced: 0, skipped: 0, status: 'idle' };
	const s = store(deps);
	const now = deps.now ?? Date.now;
	const link = deps.link ?? currentUploadLink;
	const sleep = deps.sleep ?? wait;

	const all = await s.list();
	if (all.length === 0) return { advanced: 0, skipped: 0, status: 'idle' };
	if (selectRunnable(all, now(), link()).length === 0) {
		return { advanced: 0, skipped: all.length, status: 'idle' };
	}
	if (typeof navigator !== 'undefined' && navigator.onLine === false) {
		return { advanced: 0, skipped: all.length, status: 'offline' };
	}

	// §9.3: a send that fires the instant the app is foregrounded is tightly
	// correlated with the act of opening it. Manual skips this; the person is
	// already the correlating event.
	if (!deps.manual) await sleep(flushJitterMs(deps.random));
	if (halted) return { advanced: 0, skipped: 0, status: 'idle' };

	const status = await getIntakeStatus(deps.fetchFn ?? fetch);
	if (!status.document_intake) {
		return { advanced: 0, skipped: all.length, status: 'not_open' };
	}

	let advanced = 0;
	for (let pass = 0; pass < MAX_PASSES; pass++) {
		if (halted) break;
		const batch = selectRunnable(await s.list(), now(), link());
		if (batch.length === 0) break;
		const results = await Promise.all(batch.map((item) => advanceOne(item, deps, status)));
		const moved = results.filter(Boolean).length;
		advanced += moved;
		// Nothing moved: every item in the batch is now backing off, so another
		// pass would re-select nothing. Stop rather than spin.
		if (moved === 0) break;
	}
	const remaining = await s.list();
	return { advanced, skipped: remaining.length, status: 'done' };
}

/**
 * Stop sending one item.
 *
 * Deliberately does NOT destroy the document. §19:1301 says to wipe the cipher
 * blob, but that assumes the data model where the ciphertext lives inside the
 * queue row; here it lives on LocalDocument.original.sealed, shared with the
 * kept-on-phone document. Wiping it would silently destroy someone's pristine
 * original because they tapped "stop sending".
 */
export async function cancelItem(id: string, deps: RunnerDeps = {}): Promise<void> {
	const s = store(deps);
	const item = await s.get(id);
	if (!item) return;
	if (item.original.r2) {
		const { MultipartUploader } = await import('@harborage/outbox');
		const { newPresignClient, newPartTransport } = await import('$lib/uploads');
		const fetchFn = deps.fetchFn ?? fetch;
		try {
			await new MultipartUploader(s, newPresignClient(fetchFn), newPartTransport(fetchFn)).cancel(
				item
			);
			return;
		} catch {
			// Remote abort is best effort; R2's 30-day lifecycle collects strays.
		}
	}
	await s.delete(id);
}

export async function listOutbox(deps: RunnerDeps = {}): Promise<OutboxRow[]> {
	const now = deps.now ?? Date.now;
	if (!deps.store && !(await outboxExists())) return [];
	const items = await store(deps).list();
	return items.map((item) => ({
		id: item.id,
		progress: progressFor(item, now()),
		canStop: runnability(item, now()).reason !== 'done'
	}));
}

/** Wire the flush triggers. Returns a teardown. */
export function startOutboxRunner(deps: RunnerDeps = {}): () => void {
	const kick = () => {
		if (halted) return;
		// No local guard needed: flushOutbox serialises every caller, so a
		// visibilitychange storm queues rather than overlapping.
		void flushOutbox(deps);
	};
	const onVisible = () => {
		// The only reliable trigger on iOS PWAs (§19:1310).
		if (document.visibilityState === 'visible') kick();
	};
	addEventListener('online', kick);
	document.addEventListener('visibilitychange', onVisible);
	onVisible();
	return () => {
		removeEventListener('online', kick);
		document.removeEventListener('visibilitychange', onVisible);
	};
}

/**
 * Called by the device erase before it clears anything.
 *
 * Closes the runner's own connection rather than merely dropping the reference.
 * `deleteDatabase` blocks silently while ANY connection is open, and this module
 * holds a long-lived one from the first flush onwards, so simply forgetting it
 * left `harborage-outbox` on the phone after an erase that reported success.
 */
export async function haltOutbox(): Promise<void> {
	halted = true;
	const held = sharedStore;
	sharedStore = null;
	// Let an in-flight flush finish before closing under it.
	await chain.catch(() => undefined);
	if (held) await held.close();
}
