import { expect, test } from '@playwright/test';

// Directory browse + report-a-problem (PR 9). Demo entries are injected via route
// interception, so no seed data ships in the app or D1. Production is empty until
// a curated signed pack exists.
const ENTRIES = {
	entries: [
		{
			id: 'e1',
			category: 'MEDICAL',
			name_i18n: 'City Clinic',
			region_bucket: 'IN-DL',
			address_i18n: 'Old Delhi',
			contact_method: 'PHONE',
			contact_value: '01123456789',
			languages: '["hi","en"]',
			visibility_tier: 'PUBLIC_ADDRESS',
			verification_state: 'Signed',
			is_core_infra: 1
		},
		{
			id: 'e2',
			category: 'LEGAL_AID',
			name_i18n: 'Bail Support Group',
			region_bucket: 'IN-PB',
			contact_method: 'URL',
			contact_value: 'https://example.org',
			languages: '["pa","hi"]',
			visibility_tier: 'CONTACT_BROKERED',
			verification_state: 'Corroborating',
			is_core_infra: 0
		}
	]
};

async function seed(page: import('@playwright/test').Page, directoryIntake: boolean) {
	await page.route('**/api/directory/pack', (r) => r.fulfill({ json: ENTRIES }));
	await page.route('**/api/intake/status', (r) =>
		r.fulfill({ json: { record_intake: false, directory_intake: directoryIntake } })
	);
}

test('directory shows the empty state when no entries exist', async ({ page }) => {
	await page.route('**/api/directory/pack', (r) => r.fulfill({ json: { entries: [] } }));
	await page.route('**/api/intake/status', (r) => r.fulfill({ json: { directory_intake: false } }));
	await page.goto('/directory');
	await expect(page.getByText('The directory is being checked.')).toBeVisible();
});

test('directory renders cards, honest labels, contacts, filters, and search', async ({ page }) => {
	await seed(page, false);
	await page.goto('/directory');

	await expect(page.getByRole('article')).toHaveCount(2);
	// Honest labels: Signed -> team; Corroborating -> nearby.
	await expect(page.getByText('Verified by our team')).toBeVisible();
	await expect(page.getByText('Confirmed by people nearby')).toBeVisible();
	// Contacts by method.
	await expect(page.getByRole('link', { name: 'Call' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Open' })).toBeVisible();
	// Report is hidden while directory_intake is OFF.
	await expect(page.getByRole('button', { name: 'Report a problem' })).toHaveCount(0);

	// Category filter narrows.
	await page.getByRole('button', { name: 'Medical' }).click();
	await expect(page.getByRole('article')).toHaveCount(1);
	await expect(page.getByRole('article').first()).toContainText('City Clinic');
	// Reset + search.
	await page.getByRole('button', { name: 'All', exact: true }).click();
	await page.getByPlaceholder('Search the directory').fill('bail');
	await expect(page.getByRole('article')).toHaveCount(1);
	await expect(page.getByRole('article').first()).toContainText('Bail Support Group');
});

test('report-a-problem routes to gate when directory_intake is on', async ({ page }) => {
	await seed(page, true);
	await page.route('**/api/directory/report', (r) => r.fulfill({ json: { ok: true } }));
	await page.goto('/directory');

	const report = page.getByRole('button', { name: 'Report a problem' }).first();
	await expect(report).toBeVisible();
	await report.click();
	await page.getByRole('button', { name: 'Not safe' }).click();
	await expect(page.getByText('Thanks. A person will check this.')).toBeVisible();
});
