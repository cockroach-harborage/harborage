import { expect, test } from '@playwright/test';

// M0 + M1 QA sweep (PR 12). Visits every surface on a small-phone viewport and
// asserts: no uncaught JS errors, no horizontal scroll on any primary path, every
// rendered icon has a real path (catches the missing/empty-glyph class of bug),
// and the theme toggle works in both directions.

const ROUTES = [
	'/',
	'/hi',
	'/get-help',
	'/give-help',
	'/stay-safe',
	'/stay-safe/teargas',
	'/stay-safe/detained',
	'/stay-safe/blackout',
	'/stay-safe/peaceful',
	'/stay-safe/rights',
	'/stay-safe/notices',
	'/record',
	'/record/new',
	'/nearby',
	'/directory',
	'/incidents',
	'/limits',
	'/settings',
	'/settings/language',
	'/settings/text-size',
	'/settings/identity',
	'/settings/safe-mode',
	'/settings/offline',
	'/settings/how-checking-works'
];

test.use({ viewport: { width: 360, height: 740 } });

test('every route loads with no uncaught error and no horizontal scroll', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(`${page.url()}: ${e.message}`));
	for (const route of ROUTES) {
		await page.goto(route, { waitUntil: 'networkidle' }).catch(() => {});
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		expect(overflow, `horizontal overflow on ${route}`).toBeLessThanOrEqual(2);
		// Every rendered icon must have a real path (no empty <path d="">).
		const empties = await page.evaluate(
			() =>
				[...document.querySelectorAll('svg path')].filter((p) => !(p.getAttribute('d') || '').trim())
					.length
		);
		expect(empties, `empty icon paths on ${route}`).toBe(0);
	}
	expect(errors, errors.join('\n')).toEqual([]);
});

test('an unknown route shows the 404 page', async ({ page }) => {
	await page.goto('/this-route-does-not-exist');
	await expect(page.getByText('Page not found')).toBeVisible();
});

test('theme toggle flips light and dark with no error', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	await page.goto('/');
	const toggle = page.getByRole('button', { name: 'Light or dark' });
	await toggle.click();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	await toggle.click();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
	expect(errors).toEqual([]);
});
