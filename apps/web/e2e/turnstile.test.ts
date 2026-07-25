import { expect, test, type Page } from '@playwright/test';

/**
 * The personhood check in front of intake (ARCHITECTURE §17.6).
 *
 * `/api/incidents/register` has required a `cf-turnstile-response` header since
 * M1 and the client never sent one, because no widget existed anywhere in the
 * app. Switching `document_intake` on would have returned 403 on every send —
 * a blocker no test could see, because every test runs with the flag OFF.
 *
 * These drive the flag ON by stubbing `/api/intake/status`, which is the only
 * thing the client reads to decide whether to offer the control at all.
 *
 * Turnstile's own script is stubbed rather than fetched. Reaching out to
 * challenges.cloudflare.com would make the suite depend on a third party being
 * up and on the runner having egress, and it would test THEIR code. What is
 * worth testing is ours: that the send stays closed until a token exists, that
 * a blocked script fails closed rather than open, and that the CSP actually
 * permits the origin the widget needs.
 */

const SITEKEY = '1x00000000000000000000AA';

async function stubStatus(page: Page, over: Record<string, unknown> = {}) {
	await page.route('**/api/intake/status', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				document_intake: true,
				directory_intake: false,
				intake_key: 'a'.repeat(64),
				turnstile_sitekey: SITEKEY,
				...over
			})
		})
	);
}

/** A stand-in for api.js that hands back a token when told to. */
async function stubTurnstile(page: Page, opts: { solves: boolean }) {
	await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/javascript',
			body: `
				window.turnstile = {
					render: function (el, o) {
						var d = document.createElement('div');
						d.setAttribute('data-testid', 'turnstile-stub');
						d.textContent = 'challenge';
						el.appendChild(d);
						if (${opts.solves}) setTimeout(function () { o.callback('stub-token'); }, 0);
						else setTimeout(function () { o['error-callback'](); }, 0);
						return 'w1';
					},
					remove: function () {},
					reset: function () {}
				};
			`
		})
	);
}

/** One saved note, so the list has something with a send affordance. */
async function saveNote(page: Page) {
	await page.goto('/document/new');
	await page.getByRole('button', { name: 'Write a note' }).click();
	await page.getByRole('button', { name: 'Detention / arrest' }).click();
	await page.getByRole('button', { name: 'Keep on phone' }).click();
	await expect(page.getByRole('heading', { name: 'Saved on this phone' })).toBeVisible();
}

test('the CSP permits exactly the origin Turnstile needs, and no wildcard', async ({ page }) => {
	const res = await page.goto('/document');
	const csp = res!.headers()['content-security-policy'] ?? '';
	expect(csp).toContain('frame-src https://challenges.cloudflare.com');
	// The meta policy carries script-src (SvelteKit appends its hydration hashes
	// there), so check the rendered document for it.
	const meta = await page
		.locator('meta[http-equiv="content-security-policy"]')
		.getAttribute('content');
	expect(meta).toContain("script-src 'self' https://challenges.cloudflare.com");
	// One exact host. A wildcard under challenges.cloudflare.com, or any broader
	// grant, would be a much larger hole in a browser-crypto PWA.
	expect(csp).not.toContain('*.cloudflare.com');
	expect(meta).not.toContain('*.cloudflare.com');
	expect(meta).not.toContain('unsafe-inline');
});

test('sending stays closed until the challenge is solved', async ({ page }) => {
	await stubTurnstile(page, { solves: false });
	await saveNote(page);
	await stubStatus(page);
	await page.goto('/document');

	await expect(page.getByText('Quick check that you are a person')).toBeVisible();
	// The widget reported an error, so no token exists and the send is refused.
	await expect(page.getByRole('button', { name: 'Send to archive' })).toBeDisabled();
	await expect(page.getByText('The check could not run here')).toBeVisible();
});

test('a solved challenge enables the send', async ({ page }) => {
	await stubTurnstile(page, { solves: true });
	await saveNote(page);
	await stubStatus(page);
	await page.goto('/document');

	await expect(page.getByTestId('turnstile-stub')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Send to archive' })).toBeEnabled();
});

test('a blocked Turnstile script fails closed, it does not open the send', async ({ page }) => {
	// Exactly what a CSP refusal, an offline device, or a censored path looks
	// like from the page's point of view.
	await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js', (route) =>
		route.abort()
	);
	await saveNote(page);
	await stubStatus(page);
	await page.goto('/document');

	await expect(page.getByText('The check could not run here')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Send to archive' })).toBeDisabled();
});

test('no sitekey means no send affordance at all', async ({ page }) => {
	await saveNote(page);
	// Flag ON but no sitekey: a challenge cannot be solved, so the server would
	// refuse. Offer nothing rather than a control that always fails.
	await stubStatus(page, { turnstile_sitekey: null });
	await page.goto('/document');

	await expect(page.getByRole('button', { name: 'Send to archive' })).toHaveCount(0);
	await expect(page.getByText('Quick check that you are a person')).toHaveCount(0);
});
