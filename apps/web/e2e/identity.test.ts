// Identity is the one flow where a bug loses an account permanently, and the
// worst bugs this project has had (Trusted Types breaking the capture worker,
// the /en/* 522) were invisible to types and unit tests. Everything here runs
// in a real browser against the real adapter build, because WebCrypto key
// import, IndexedDB persistence and Trusted Types only exist there.
import { expect, test } from '@playwright/test';

const PAGE = '/settings/identity';

/**
 * allInnerTexts() does NOT auto-wait, so it happily returns [] the instant
 * before the list renders. Wait for the count first or this races.
 */
async function readWords(page: import('@playwright/test').Page): Promise<string[]> {
	const items = page.locator('[data-testid="backup-words"] li');
	await expect(items).toHaveCount(12);
	return items.allInnerTexts();
}

/** Strip the leading position number the list renders next to each word. */
function bare(items: string[]): string[] {
	return items.map((t) => t.replace(/^\d+\s*/, '').trim());
}

async function createIdentity(page: import('@playwright/test').Page) {
	await page.goto(PAGE);
	await page.getByRole('button', { name: 'Make an account' }).click();
	await expect(page.locator('[data-testid="backup-words"] li')).toHaveCount(12);
	return bare(await readWords(page));
}

test.beforeEach(async ({ page }) => {
	await page.goto(PAGE);
	// Each test starts with no account, whatever a previous one left behind.
	await page.evaluate(() => indexedDB.deleteDatabase('harborage-identity'));
});

test('offers create and restore when there is no account', async ({ page }) => {
	await page.goto(PAGE);
	await expect(page.getByRole('heading', { name: 'No account on this phone' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Make an account' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Use my backup words' })).toBeVisible();
});

test('creates an account and shows exactly twelve backup words', async ({ page }) => {
	const words = await createIdentity(page);
	expect(words).toHaveLength(12);
	for (const w of words) expect(w).toMatch(/^[a-z]+$/);
	// A repeated word would mean the generator is broken; BIP39 can legitimately
	// repeat, so this only asserts they are not all the same value.
	expect(new Set(words).size).toBeGreaterThan(1);
});

test('will not accept the wrong words at the confirm step', async ({ page }) => {
	await createIdentity(page);
	await page.getByRole('button', { name: 'I wrote them down' }).click();

	const inputs = page.locator('input[type="text"]');
	await expect(inputs).toHaveCount(3);
	for (let i = 0; i < 3; i++) await inputs.nth(i).fill('zzz');
	await page.getByRole('button', { name: 'Check' }).click();

	await expect(page.getByRole('alert')).toContainText('do not match');
	// Still on the confirm step: a failed check must not advance the flow.
	await expect(page.getByRole('heading', { name: 'Check your backup words' })).toBeVisible();
});

test('confirming the right words erases them from the phone by default', async ({ page }) => {
	const words = await createIdentity(page);
	await page.getByRole('button', { name: 'I wrote them down' }).click();

	// The page asks for specific positions; read them back off the labels.
	const labels = await page.locator('label.field span').allInnerTexts();
	const positions = labels.map((t) => Number(t.replace(/\D/g, '')) - 1);
	const inputs = page.locator('input[type="text"]');
	for (let i = 0; i < positions.length; i++) {
		await inputs.nth(i).fill(words[positions[i]!]!);
	}
	await page.getByRole('button', { name: 'Check' }).click();

	await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
	// Erased is the default, so the keep-words control is gone and the page says why.
	await expect(page.getByText('The words are not on this phone')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Show backup words' })).toHaveCount(0);
});

test('keeping the words on the phone is opt-in and then they can be shown', async ({ page }) => {
	const words = await createIdentity(page);
	await page.getByRole('button', { name: 'I wrote them down' }).click();

	const labels = await page.locator('label.field span').allInnerTexts();
	const positions = labels.map((t) => Number(t.replace(/\D/g, '')) - 1);
	const inputs = page.locator('input[type="text"]');
	for (let i = 0; i < positions.length; i++) {
		await inputs.nth(i).fill(words[positions[i]!]!);
	}
	await page.locator('input[type="checkbox"]').check();
	await page.getByRole('button', { name: 'Check' }).click();

	await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
	await page.getByRole('button', { name: 'Show backup words' }).click();
	expect(bare(await readWords(page))).toEqual(words);
});

test('the same account survives a reload', async ({ page }) => {
	await createIdentity(page);
	await page.goto(PAGE);
	await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
	const first = await page.getByTestId('fingerprint').innerText();

	await page.reload();
	await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
	expect(await page.getByTestId('fingerprint').innerText()).toBe(first);
});

test('restoring the same words rebuilds the same account', async ({ page }) => {
	const words = await createIdentity(page);
	await page.goto(PAGE);
	const original = await page.getByTestId('fingerprint').innerText();

	// Wipe, then come back with only the paper copy.
	await page.getByRole('button', { name: 'Remove account from this phone' }).click();
	await page.getByRole('button', { name: 'Remove it' }).click();
	await expect(page.getByRole('heading', { name: 'No account on this phone' })).toBeVisible();

	await page.getByRole('button', { name: 'Use my backup words' }).click();
	await page.locator('textarea').fill(words.join(' '));
	await page.getByRole('button', { name: 'Bring my account back' }).click();

	await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
	// Same words in, same identity out. If this ever fails, a restore silently
	// hands someone a different account and their history is gone.
	expect(await page.getByTestId('fingerprint').innerText()).toBe(original);
});

test('restore forgives sloppy typing but rejects invalid words', async ({ page }) => {
	const words = await createIdentity(page);
	await page.goto(PAGE);
	const original = await page.getByTestId('fingerprint').innerText();
	await page.getByRole('button', { name: 'Remove account from this phone' }).click();
	await page.getByRole('button', { name: 'Remove it' }).click();

	await page.getByRole('button', { name: 'Use my backup words' }).click();
	await page.locator('textarea').fill('these are not real backup words at all not one');
	await page.getByRole('button', { name: 'Bring my account back' }).click();
	await expect(page.getByRole('alert')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Your account' })).toHaveCount(0);

	// Autocapitalisation and stray whitespace are what a phone keyboard does.
	const messy = `  ${words.map((w, i) => (i % 2 ? w.toUpperCase() : w)).join('   ')}  `;
	await page.locator('textarea').fill(messy);
	await page.getByRole('button', { name: 'Bring my account back' }).click();
	await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
	expect(await page.getByTestId('fingerprint').innerText()).toBe(original);
});

test('wiping removes the account and cancelling does not', async ({ page }) => {
	await createIdentity(page);
	await page.goto(PAGE);

	await page.getByRole('button', { name: 'Remove account from this phone' }).click();
	await page.getByRole('button', { name: 'Go back' }).click();
	await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();

	await page.getByRole('button', { name: 'Remove account from this phone' }).click();
	await page.getByRole('button', { name: 'Remove it' }).click();
	await expect(page.getByRole('heading', { name: 'No account on this phone' })).toBeVisible();
});

test('signs under a compartment with a non-extractable key', async ({ page }) => {
	await createIdentity(page);
	// Reach the module directly: the signing path has no UI yet (that is slice 2),
	// but the key custody it depends on ships here and must be proven in a real
	// browser, not only under Node's WebCrypto.
	const result = await page.evaluate(async () => {
		const idb: IDBDatabase = await new Promise((resolve, reject) => {
			const req = indexedDB.open('harborage-identity', 1);
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
		const key: unknown = await new Promise((resolve, reject) => {
			const tx = idb.transaction('keys').objectStore('keys').get('document/1/sign');
			tx.onsuccess = () => resolve(tx.result);
			tx.onerror = () => reject(tx.error);
		});
		const stored = key as { privateKey: CryptoKey; publicKey: Uint8Array } | undefined;
		if (!stored) return { found: false };
		let exportable = true;
		try {
			await crypto.subtle.exportKey('pkcs8', stored.privateKey);
		} catch {
			exportable = false;
		}
		const sig = await crypto.subtle.sign(
			{ name: stored.privateKey.algorithm.name },
			stored.privateKey,
			new TextEncoder().encode('probe')
		);
		return {
			found: true,
			extractable: stored.privateKey.extractable,
			exportable,
			sigLength: new Uint8Array(sig).length,
			pubLength: stored.publicKey.length
		};
	});

	expect(result.found).toBe(true);
	expect(result.extractable).toBe(false);
	// The whole point of the custody design: the key can be used and not copied.
	expect(result.exportable).toBe(false);
	expect(result.sigLength).toBe(64);
	expect(result.pubLength).toBeGreaterThanOrEqual(32);
});
