import { expect, test } from '@playwright/test';

// Every route is prerendered, so the CSP + Trusted Types that actually protect
// users at runtime come from static/_headers. For a browser-crypto PWA an XSS
// equals the top-tier code-injection threat, so this must never silently regress.
test('prerendered pages carry the Trusted-Types CSP header', async ({ page }) => {
	const res = await page.goto('/stay-safe');
	const csp = res?.headers()['content-security-policy'] ?? '';
	expect(csp).toContain("require-trusted-types-for 'script'");
	expect(csp).toContain("frame-ancestors 'none'");
	expect(csp).not.toContain('unsafe-inline');
});

test('the page also has the kit.csp meta policy for script-src', async ({ page }) => {
	await page.goto('/stay-safe');
	const meta = page.locator('meta[http-equiv="content-security-policy"]');
	await expect(meta).toHaveCount(1);
	expect(await meta.getAttribute('content')).not.toContain('unsafe-inline');
});
