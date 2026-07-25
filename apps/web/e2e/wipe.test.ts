import { expect, test, type Page } from '@playwright/test';
import { createAccount } from './helpers/account.ts';

/**
 * Erasing what is on this phone (ARCHITECTURE §19:1302, §19:1308).
 *
 * The property that needs guarding is the SCOPE. §19:1308 says the erase clears
 * IndexedDB, which would take the account with it; identity.ts says the wipes are
 * deliberately separate. The account goes only when asked, and these tests are
 * what stops that quietly widening.
 */

async function saveNote(page: Page): Promise<void> {
	await page.goto('/document/new');
	await page.getByRole('button', { name: 'Write a note' }).click();
	await page.getByRole('button', { name: 'Detention / arrest' }).click();
	await page.getByRole('button', { name: 'Keep on phone' }).click();
	await expect(page.getByRole('heading', { name: 'Saved on this phone' })).toBeVisible();
}

async function databaseNames(page: Page): Promise<string[]> {
	return page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name ?? ''));
}

async function erase(page: Page, alsoAccount: boolean): Promise<void> {
	await page.goto('/settings/safe-mode');
	await page.getByTestId('wipe-start').click();
	if (alsoAccount) await page.getByTestId('wipe-account').check();
	await page.getByTestId('wipe-go').click();
	await page.waitForURL((url) => url.pathname === '/directory');
}

test('erasing clears the documents, the queue, and the saved pages', async ({ page }) => {
	await page.goto('/');
	await page.evaluate(() => navigator.serviceWorker.ready);
	await saveNote(page);
	// A distinctively named cache, so the assertion below is about what the
	// erase REMOVED rather than about a count. SvelteKit re-registers the
	// service worker on the next page load and it re-precaches the public
	// shell, so asserting "no caches at all" afterwards would be asserting the
	// app is broken. Only this seeded key proves the erase reached the caches.
	await page.evaluate(() => caches.open('probe-cache-not-the-shell'));

	// Control: the things we are about to assert are gone must exist first.
	expect(await databaseNames(page)).toContain('harborage-records');
	expect(await page.evaluate(async () => (await caches.keys()).length)).toBeGreaterThan(1);

	await erase(page, false);

	expect(await databaseNames(page)).not.toContain('harborage-records');
	// Nothing recreates the queue database, because only a writer opens it.
	expect(await databaseNames(page)).not.toContain('harborage-outbox');
	expect(await page.evaluate(async () => await caches.keys())).not.toContain(
		'probe-cache-not-the-shell'
	);
});

test('erasing keeps the account unless it is asked for', async ({ page }) => {
	await createAccount(page);
	await saveNote(page);
	await erase(page, false);

	expect(await databaseNames(page)).not.toContain('harborage-records');
	// The account survives, and the page still shows it.
	await page.goto('/settings/identity');
	await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
});

test('checking the box also removes the account', async ({ page }) => {
	await createAccount(page);
	await saveNote(page);
	await erase(page, true);

	await page.goto('/settings/identity');
	await expect(page.getByRole('heading', { name: 'No account on this phone' })).toBeVisible();
});

test('the confirm step says a not-yet-vaulted original is destroyed', async ({ page }) => {
	await page.goto('/settings/safe-mode');
	await page.getByTestId('wipe-start').click();
	await expect(page.getByText('never reached the vault is destroyed')).toBeVisible();
	// And it does not overstate what it can reach.
	await expect(page.getByText('does not clear your browser history')).toHaveCount(0);
	await page.getByRole('button', { name: 'Go back' }).click();
	await expect(page.getByText('does not clear your browser history')).toBeVisible();
});

test('the shell is served fresh after an erase, not from the old cache', async ({ page }) => {
	await page.goto('/');
	await page.evaluate(() => navigator.serviceWorker.ready);
	await erase(page, false);

	// The worker is gone, so the next navigation cannot be answered from a cache
	// whose contents the user believes were destroyed.
	const res = await page.goto('/stay-safe');
	expect(res?.fromServiceWorker()).toBe(false);
	expect(await page.evaluate(() => navigator.serviceWorker.controller === null)).toBe(true);
});
