import { expect, test } from '@playwright/test';

// Offline cold-boot gate (ARCHITECTURE §10.1, M0 scope): the shell, the five
// tabs, Stay safe, and the honest-limits page must render with the network off.

test('shell renders with five tabs, heroes, and CSP', async ({ page }) => {
	await page.goto('/');
	await expect(page).toHaveTitle(/Harborage/);
	await expect(page.getByRole('link', { name: /Get help/ })).toBeVisible();
	await expect(page.getByRole('link', { name: /Give help/ })).toBeVisible();
	const nav = page.getByRole('navigation', { name: 'Main' });
	await expect(nav.getByRole('link')).toHaveCount(5);
	const csp = page.locator('meta[http-equiv="content-security-policy"]');
	await expect(csp).toHaveCount(1);
	expect(await csp.getAttribute('content')).not.toContain('unsafe-inline');
});

test('hindi locale renders the frozen hero strings', async ({ page }) => {
	await page.goto('/hi');
	await expect(page.getByRole('link', { name: /मदद लें/ })).toBeVisible();
	await expect(page.getByRole('link', { name: /मदद दें/ })).toBeVisible();
});

test('quick-exit replaces to Home with no Back trail', async ({ page }) => {
	await page.goto('/stay-safe');
	await page.getByRole('button', { name: 'Close' }).click();
	await page.waitForURL((url) => url.pathname === '/');
	// location.replace means Back must not return to the sensitive page.
	await page.goBack().catch(() => null);
	expect(new URL(page.url()).pathname).not.toBe('/stay-safe');
});

test('offline cold boot serves precached pages', async ({ page, context }) => {
	await page.goto('/');
	await page.evaluate(async () => {
		await navigator.serviceWorker.ready;
	});
	await context.setOffline(true);
	await page.goto('/stay-safe');
	await expect(page.getByText('If there is teargas')).toBeVisible();
	await page.goto('/limits');
	await expect(page.getByRole('heading', { name: /cannot protect/ })).toBeVisible();
	await context.setOffline(false);
});
