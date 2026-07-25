import { expect, test, type Page } from '@playwright/test';
import { stubIntakeOpen, stubRegister, stubVault } from './helpers/media-stubs.ts';
import { createAccount } from './helpers/account.ts';

/**
 * The outbox runner (ARCHITECTURE §19:1304-1315).
 *
 * The engine in packages/outbox has been complete since M1 and nothing drove
 * it: a killed upload persisted its cursor and was never picked back up. These
 * prove the driver actually resumes, actually respects the link, and actually
 * refuses the things it must refuse.
 *
 * TEST ORDER MATTERS. The first test is a negative control: a clean upload that
 * reaches every stub. Without it, every "was not called" assertion below could
 * be green because nothing ran at all — which is exactly how a Turnstile test
 * passed in session 9 for the wrong reason.
 */

const PART = 5 * 1024 * 1024;

interface SeedOptions {
	id?: string;
	sizeBytes?: number;
	receipt?: string | null;
	nextPart?: number;
	parts?: { n: number; etag: string }[];
	withCursor?: boolean;
	createdAt?: number;
}

/**
 * Write a document and its queue row straight into IndexedDB.
 *
 * Deliberately not driven through the capture UI: these tests are about resume,
 * and resume means picking up a row that a PREVIOUS session left behind. Seeding
 * is the only honest way to express "a previous session".
 */
async function seed(page: Page, opts: SeedOptions = {}): Promise<string> {
	const id = opts.id ?? 'doc-1';
	await page.goto('/document');
	await page.evaluate(
		async ({ id, sizeBytes, receipt, nextPart, parts, withCursor, createdAt, PART }) => {
			const open = (name: string, version: number, stores: [string, string][]) =>
				new Promise<IDBDatabase>((resolve, reject) => {
					const req = indexedDB.open(name, version);
					req.onupgradeneeded = () => {
						for (const [store, keyPath] of stores) {
							if (!req.result.objectStoreNames.contains(store)) {
								req.result.createObjectStore(store, keyPath ? { keyPath } : undefined);
							}
						}
					};
					req.onsuccess = () => resolve(req.result);
					req.onerror = () => reject(req.error);
				});
			const put = (db: IDBDatabase, store: string, value: unknown) =>
				new Promise<void>((resolve, reject) => {
					const tx = db.transaction(store, 'readwrite');
					tx.objectStore(store).put(value as never);
					tx.oncomplete = () => resolve();
					tx.onerror = () => reject(tx.error);
				});

			const docs = await open('harborage-records', 2, [
				['records', 'id'],
				['capture-quarantine', 'id']
			]);
			await put(docs, 'records', {
				id,
				kind: 'photo',
				createdAt,
				redactionConfirmed: true,
				originalStatus: 'on_device_only',
				derivative: { sha256: 'd'.repeat(64), mime: 'image/webp', blob: new Blob([new Uint8Array(64)]) },
				original: {
					sha256: 'o'.repeat(64),
					mime: 'image/jpeg',
					sealed: new Blob([new Uint8Array(sizeBytes)]),
					key: new Uint8Array(32)
				}
			});
			docs.close();

			const outbox = await open('harborage-outbox', 1, [
				['items', 'id'],
				['cipher-blobs', '']
			]);
			await put(outbox, 'items', {
				id,
				state: withCursor ? 'uploading' : 'registered',
				...(receipt ? { incidentReceipt: receipt } : {}),
				derivative: { sha256: 'd'.repeat(64), size: 64, mime: 'image/webp', uploaded: true },
				original: {
					sha256: 'o'.repeat(64),
					size: sizeBytes,
					mime: 'image/jpeg',
					...(withCursor
						? {
								r2: {
									bucket: 'harborage-evidence-vault',
									key: 'stub-vault-key',
									uploadId: 'stub-upload-1',
									partSize: PART,
									parts,
									nextPart
								}
							}
						: {})
				},
				originalStatus: withCursor ? 'vaulting' : 'on_device_only',
				attempts: 0,
				nextEarliestRetry: 0,
				createdAt,
				maxAge: 30 * 24 * 3600 * 1000
			});
			outbox.close();
		},
		{
			id,
			sizeBytes: opts.sizeBytes ?? PART + 1000,
			receipt: opts.receipt === undefined ? 'receipt-seed' : opts.receipt,
			nextPart: opts.nextPart ?? 1,
			parts: opts.parts ?? [],
			withCursor: opts.withCursor ?? false,
			createdAt: opts.createdAt ?? Date.now() - 1000,
			PART
		}
	);
	return id;
}

/** Read a queue row back out of IndexedDB. Null once the row is gone. */
async function readRow(page: Page, id: string) {
	return page.evaluate(async (id) => {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const req = indexedDB.open('harborage-outbox', 1);
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
		const row = await new Promise<unknown>((resolve, reject) => {
			const tx = db.transaction('items', 'readonly');
			const r = tx.objectStore('items').get(id);
			r.onsuccess = () => resolve(r.result ?? null);
			r.onerror = () => reject(r.error);
		});
		db.close();
		return row as {
			originalStatus: string;
			attempts: number;
			original: { r2?: { nextPart: number; parts: { n: number; etag: string }[] } };
		} | null;
	}, id);
}

async function readCustody(page: Page, id: string): Promise<string | null> {
	return page.evaluate(async (id) => {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const req = indexedDB.open('harborage-records', 2);
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
		const row = await new Promise<{ originalStatus?: string } | null>((resolve, reject) => {
			const tx = db.transaction('records', 'readonly');
			const r = tx.objectStore('records').get(id);
			r.onsuccess = () => resolve(r.result ?? null);
			r.onerror = () => reject(r.error);
		});
		db.close();
		return row?.originalStatus ?? null;
	}, id);
}

/**
 * Press "Try now".
 *
 * Deliberately does not wait for the button afterwards: the control is rendered
 * only while a queue row exists, so a successful flush removes it. Each test
 * polls for the outcome it cares about instead.
 */
async function flush(page: Page): Promise<void> {
	await page.reload();
	const button = page.getByTestId('outbox-try-now');
	await expect(button).toBeVisible();
	await button.click();
}

test.beforeEach(async ({ page }) => {
	await page.goto('/document');
	await page.evaluate(async () => {
		indexedDB.deleteDatabase('harborage-records');
		indexedDB.deleteDatabase('harborage-outbox');
	});
	await stubIntakeOpen(page);
	await createAccount(page);
	await stubIntakeOpen(page);
});

test('a queued vault upload runs every step to completion', async ({ page }) => {
	// THE NEGATIVE CONTROL. Every "was not called" assertion in this file is
	// worthless unless this proves the stubs are reachable and the path works.
	const vault = await stubVault(page);
	const id = await seed(page, { sizeBytes: PART + 1000 }); // 2 parts
	await flush(page);

	await expect
		.poll(async () => (await readRow(page, id)) === null, { timeout: 20_000 })
		.toBe(true);
	expect(vault.creates).toBe(1);
	expect(vault.partRequests).toEqual([1, 2]);
	expect(vault.puts).toEqual([1, 2]);
	expect(vault.completes).toBe(1);
	expect(await readCustody(page, id)).toBe('vaulted');
});

test('a resumed upload asks only for the parts it has not sent', async ({ page }) => {
	const vault = await stubVault(page);
	const id = await seed(page, {
		sizeBytes: PART * 3 + 10, // 4 parts
		withCursor: true,
		nextPart: 3,
		parts: [
			{ n: 1, etag: '"aaa1"' },
			{ n: 2, etag: '"aaa2"' }
		]
	});
	await flush(page);

	await expect.poll(async () => (await readRow(page, id)) === null, { timeout: 20_000 }).toBe(true);
	// Never re-created the multipart, never re-sent a finished part.
	expect(vault.creates).toBe(0);
	expect(vault.partRequests).toEqual([3, 4]);
	expect(await readCustody(page, id)).toBe('vaulted');
});

test('a 429 on complete does not restart the multipart', async ({ page }) => {
	// The #53 regression, end to end. A transient failure at the last step used
	// to drop the cursor and re-upload every part from zero.
	const vault = await stubVault(page, { completeStatus: [429] });
	const id = await seed(page, {
		sizeBytes: PART * 2 + 10, // 3 parts
		withCursor: true,
		nextPart: 4,
		parts: [
			{ n: 1, etag: '"aaa1"' },
			{ n: 2, etag: '"aaa2"' },
			{ n: 3, etag: '"aaa3"' }
		]
	});
	await flush(page);

	await expect.poll(async () => (await readRow(page, id))?.attempts ?? 0, { timeout: 20_000 }).toBe(
		1
	);
	const row = await readRow(page, id);
	expect(row?.original.r2?.nextPart).toBe(4);
	expect(row?.original.r2?.parts).toHaveLength(3);
	expect(row?.originalStatus).toBe('vaulting');
	// The restart path was never entered.
	expect(vault.creates).toBe(0);
	expect(vault.heads).toBe(0);
	expect(vault.partRequests).toEqual([]);
});

test('an item with no receipt is never sent on its own', async ({ page }) => {
	const register = await stubRegister(page);
	const vault = await stubVault(page);
	const id = await seed(page, { receipt: null });
	await flush(page);

	// Register needs a live personhood token, so a background flush must not
	// attempt it. The row stays, and the row says a person is needed.
	expect(register.count).toBe(0);
	expect(vault.creates).toBe(0);
	expect(await readRow(page, id)).not.toBeNull();
	await expect(page.getByTestId(`outbox-progress-${id}`)).toContainText('finish the check');
});

/**
 * Hold each /media/create open long enough to see whether two overlap.
 *
 * Registered AFTER stubVault so it takes precedence (Playwright matches the most
 * recently added handler first), and it fulfils the response itself so parts and
 * complete still run through the working stub and the item actually finishes.
 * If items did not finish, the runner would stop after one pass and the test
 * would "prove" serial behaviour on every link.
 */
async function timedCreates(page: Page, windows: { start: number; end: number }[]): Promise<void> {
	await page.route('**/media/create', async (route) => {
		const start = Date.now();
		await new Promise((r) => setTimeout(r, 400));
		windows.push({ start, end: Date.now() });
		return route.fulfill({ json: { key: `k-${windows.length}`, uploadId: `u-${windows.length}` } });
	});
}

function anyOverlap(windows: { start: number; end: number }[]): boolean {
	return windows.some((a, i) =>
		windows.some((b, j) => i !== j && a.start < b.end && b.start < a.end)
	);
}

async function setLink(page: Page, effectiveType: string): Promise<void> {
	await page.addInitScript((t) => {
		Object.defineProperty(navigator, 'connection', {
			configurable: true,
			get: () => ({ effectiveType: t })
		});
	}, effectiveType);
}

test('on a 2G link the queue sends one document at a time', async ({ page }) => {
	const windows: { start: number; end: number }[] = [];
	await stubVault(page);
	await timedCreates(page, windows);
	await setLink(page, '2g');
	for (const n of [1, 2, 3]) await seed(page, { id: `slow-${n}`, createdAt: Date.now() - n * 1000 });
	await flush(page);

	await expect.poll(() => windows.length, { timeout: 30_000 }).toBe(3);
	// Parallel parts on 2G cause congestion collapse, which is why §19 is
	// emphatic about this tier.
	expect(anyOverlap(windows)).toBe(false);
});

test('on a 4G link the queue sends several documents at once', async ({ page }) => {
	const windows: { start: number; end: number }[] = [];
	await stubVault(page);
	await timedCreates(page, windows);
	await setLink(page, '4g');
	for (const n of [1, 2, 3]) await seed(page, { id: `fast-${n}`, createdAt: Date.now() - n * 1000 });
	await flush(page);

	await expect.poll(() => windows.length, { timeout: 30_000 }).toBe(3);
	expect(anyOverlap(windows)).toBe(true);
});

test('stopping a send clears the queue row and keeps the document', async ({ page }) => {
	const vault = await stubVault(page);
	const id = await seed(page, { withCursor: true, nextPart: 1 });
	await page.reload();

	await page.getByRole('button', { name: 'Stop sending' }).first().click();
	await expect.poll(async () => (await readRow(page, id)) === null, { timeout: 10_000 }).toBe(true);
	expect(vault.aborts).toBe(1);

	// The document and its sealed original survive. Stopping a send must never
	// destroy the one copy of something that may exist nowhere else.
	const kept = await page.evaluate(async (id) => {
		const db = await new Promise<IDBDatabase>((resolve) => {
			const req = indexedDB.open('harborage-records', 2);
			req.onsuccess = () => resolve(req.result);
		});
		const row = await new Promise<{ original?: { sealed: Blob } } | null>((resolve) => {
			const tx = db.transaction('records', 'readonly');
			const r = tx.objectStore('records').get(id);
			r.onsuccess = () => resolve(r.result ?? null);
		});
		db.close();
		return row?.original?.sealed.size ?? 0;
	}, id);
	expect(kept).toBeGreaterThan(0);
});

test('removing a document leaves no queue row behind', async ({ page }) => {
	await stubVault(page);
	const id = await seed(page);
	await page.reload();

	await page.getByRole('button', { name: 'Remove' }).first().click();
	await expect.poll(async () => (await readRow(page, id)) === null, { timeout: 10_000 }).toBe(true);
});
