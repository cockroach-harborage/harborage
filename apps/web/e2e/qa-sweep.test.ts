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
	'/settings/how-checking-works',
	// Were missing from the sweep entirely.
	'/settings/share-pack',
	'/settings/verify-channel',
	// Hindi is a real URL prefix, so every locale variant is a real route that
	// can break on its own. Only '/hi' was covered before.
	'/hi/stay-safe',
	'/hi/directory',
	'/hi/incidents',
	'/hi/limits',
	'/hi/settings'
];

// English is unprefixed, so these are not real routes — but they are the first
// URL anyone who has seen /hi/... will guess, and they used to return 522.
// _redirects turns them into a permanent redirect to the canonical path.
const EN_PREFIXED = ['/en', '/en/limits', '/en/stay-safe', '/en/directory'];

test.use({ viewport: { width: 360, height: 740 } });

test('every route loads with no uncaught error and no horizontal scroll', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(`${page.url()}: ${e.message}`));
	for (const route of ROUTES) {
		// Assert the STATUS. This used to swallow the result of goto(), so a route
		// returning 5xx passed as long as its error page had no horizontal scroll —
		// which is how a permanent 522 on /en/* reached production unnoticed.
		const res = await page.goto(route, { waitUntil: 'networkidle' });
		expect(res, `no response for ${route}`).not.toBeNull();
		expect(res!.status(), `bad status on ${route}`).toBeLessThan(400);
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		expect(overflow, `horizontal overflow on ${route}`).toBeLessThanOrEqual(2);
		// Every rendered icon must have a real path (no empty <path d="">).
		const empties = await page.evaluate(
			() =>
				[...document.querySelectorAll('svg path')].filter(
					(p) => !(p.getAttribute('d') || '').trim()
				).length
		);
		expect(empties, `empty icon paths on ${route}`).toBe(0);
	}
	expect(errors, errors.join('\n')).toEqual([]);
});

test('/en/* redirects to the canonical unprefixed URL instead of timing out', async ({ page }) => {
	for (const route of EN_PREFIXED) {
		const res = await page.goto(route, { waitUntil: 'domcontentloaded' });
		expect(res, `no response for ${route}`).not.toBeNull();
		// A 5xx here means the reroute -> prerendered self-subrequest is back.
		expect(res!.status(), `bad status on ${route}`).toBeLessThan(400);
		expect(new URL(page.url()).pathname, `${route} should drop the /en prefix`).not.toMatch(
			/^\/en(\/|$)/
		);
	}
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
