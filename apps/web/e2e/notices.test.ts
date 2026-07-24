import { expect, test } from '@playwright/test';

// Demo notices exist ONLY as route interception — nothing is seeded server-side.
const DEMO = {
	published: true,
	notices: [
		{
			id: 'ntc_demo_1',
			epoch: 1,
			notice_type: 'safety_directive',
			title_i18n: JSON.stringify({ en: 'Move away from the east gate', hi: '' }),
			body_i18n: JSON.stringify({ en: 'Organizers ask people to move west calmly.', hi: '' }),
			area: 'east gate',
			payload_hash: 'aa'.repeat(32),
			signature_set: '[]',
			signer_key_ids: '[]',
			published_at: '2026-07-25',
			supersedes: null,
			superseded_by: null
		},
		{
			id: 'ntc_demo_2',
			epoch: 1,
			notice_type: 'transparency',
			title_i18n: JSON.stringify({ en: 'Transparency update', hi: '' }),
			body_i18n: JSON.stringify({ en: 'A routine transparency note.', hi: '' }),
			area: null,
			payload_hash: 'bb'.repeat(32),
			signature_set: '[]',
			signer_key_ids: '[]',
			published_at: '2026-07-24',
			supersedes: null,
			superseded_by: null
		}
	]
};

test('notices render with the directive interstitial and an unverified label', async ({ page }) => {
	await page.route('**/api/notices', (r) => r.fulfill({ json: DEMO }));
	await page.goto('/stay-safe/notices');

	await expect(page.getByText('Move away from the east gate')).toBeVisible();
	// Directive class carries the hard interstitial; informational class does not.
	await expect(page.getByText(/Do not act on this without checking/)).toBeVisible();
	// Nothing verifies on-device at M1 (no trusted key directory).
	await expect(page.getByText('Not verified on this device yet.').first()).toBeVisible();
	await expect(page.getByText('Transparency update')).toBeVisible();
});

test('notices show the empty state when none are published', async ({ page }) => {
	await page.route('**/api/notices', (r) => r.fulfill({ json: { published: false, notices: [] } }));
	await page.goto('/stay-safe/notices');
	await expect(page.getByText('No notices yet.')).toBeVisible();
});

test('a cached notice still renders offline with a stale badge', async ({ page }) => {
	// First load online populates the IndexedDB cache.
	await page.route('**/api/notices', (r) => r.fulfill({ json: DEMO }));
	await page.goto('/stay-safe/notices');
	await expect(page.getByText('Move away from the east gate')).toBeVisible();

	// Now the fetch fails (offline / blocked); the page must fall back to the
	// cached copy with a stale badge, never go dark.
	await page.unroute('**/api/notices');
	await page.route('**/api/notices', (r) => r.abort());
	await page.reload();
	await expect(page.getByText('Move away from the east gate')).toBeVisible();
	await expect(page.getByText(/last saved copy/)).toBeVisible();
});

test('the verify-the-channel page names the canonical domain and the pending state', async ({
	page
}) => {
	await page.goto('/settings/verify-channel');
	await expect(page.getByText('cockroachharborage.org')).toBeVisible();
	await expect(page.getByText(/Key fingerprints will be published/)).toBeVisible();
});
