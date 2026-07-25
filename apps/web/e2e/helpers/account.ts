/**
 * Drive the real account-creation flow.
 *
 * credentialHeaders() throws without an account, so every send-path test needs
 * one. No existing e2e has ever exercised the credential path, which is why this
 * goes through the actual UI rather than seeding IndexedDB: a seeded key that
 * does not match what the app would have written proves nothing about sending.
 */
import { expect, type Page } from '@playwright/test';

export async function createAccount(page: Page): Promise<void> {
	await page.goto('/settings/identity');
	await page.evaluate(() => indexedDB.deleteDatabase('harborage-identity'));
	await page.goto('/settings/identity');
	await page.getByRole('button', { name: 'Make an account' }).click();

	const words = await page.locator('[data-testid="backup-words"] li').allInnerTexts();
	expect(words).toHaveLength(12);
	await page.getByRole('button', { name: 'I wrote them down' }).click();

	// The page asks for three specific positions; read them off the labels.
	const labels = await page.locator('label.field span').allInnerTexts();
	const positions = labels.map((t) => Number(t.replace(/\D/g, '')) - 1);
	const inputs = page.locator('input[type="text"]');
	for (let i = 0; i < positions.length; i++) {
		await inputs.nth(i).fill(words[positions[i]!]!.trim());
	}
	await page.getByRole('button', { name: 'Check' }).click();
	await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
}
