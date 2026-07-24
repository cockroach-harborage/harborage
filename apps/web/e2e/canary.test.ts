import { expect, test } from '@playwright/test';

// At M1 no canary key is pinned and no signature ships, so the safety signal
// reads "not set up yet" (the honest fail posture), never a false all-clear.
test('the limits page shows the canary as not established at M1', async ({ page }) => {
	await page.goto('/limits');
	await expect(page.getByRole('heading', { name: /cannot protect/ })).toBeVisible();
	await expect(page.getByText(/Safety signal:/)).toBeVisible();
	await expect(page.getByText(/Not set up yet/)).toBeVisible();
});
