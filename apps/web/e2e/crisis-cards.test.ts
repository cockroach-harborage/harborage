import { expect, test } from '@playwright/test';

// Crisis cards (PR 10). Bundled from the signed content pack; the draft banner
// shows until a counsel/medic-signed pack replaces the draft. Cards render fully
// offline with no network.

test('the detained card shows the draft banner and the rights steps', async ({ page }) => {
	await page.goto('/stay-safe/detained');
	await expect(page.getByRole('heading', { name: 'If you are detained' })).toBeVisible();
	await expect(page.getByRole('alert')).toContainText('Draft');
	await expect(page.getByText('Stay calm. Do not resist.')).toBeVisible();
	await expect(
		page.getByText('You should be produced before a magistrate within 24 hours.')
	).toBeVisible();
	await expect(page.getByText('Not legal advice')).toBeVisible();
});

test('crisis cards render offline (bundled, no network)', async ({ page, context }) => {
	await page.goto('/');
	await page.evaluate(async () => {
		await navigator.serviceWorker.ready;
	});
	await context.setOffline(true);
	await page.goto('/stay-safe/teargas');
	await expect(page.getByText('Move to fresh air and higher ground.')).toBeVisible();
	await context.setOffline(false);
});
