import { expect, test } from '@playwright/test';

// The public incident browse (PR 8). Demo rows are injected by intercepting the
// index fetch, so no seed data ships in the app or D1. In production the surface
// is empty / "not open yet" until incidents_publish is flipped and rows exist.
const DEMO = {
	published: true,
	incidents: [
		{
			id: 'a',
			type: 'detention',
			occurred_date: '2026-07-20',
			region_bucket: 'IN-DL',
			narrative: 'Several people held near the march.',
			verification_state: 'Verified',
			corroboration_count: 5
		},
		{
			id: 'b',
			type: 'crowd_weapons',
			occurred_date: '2026-07-19',
			region_bucket: 'IN-PB-LDH',
			narrative: 'Tear gas used on a peaceful crowd.',
			verification_state: 'Community-Corroborated',
			corroboration_count: 3
		}
	]
};

test('incident browse shows the not-open state when the flag is off', async ({ page }) => {
	await page.route('**/api/incidents/index', (r) =>
		r.fulfill({ json: { published: false, incidents: [] } })
	);
	await page.goto('/incidents');
	await expect(page.getByText('The public record is not open yet.')).toBeVisible();
});

test('incident browse renders honest labels, filters, and client-side search', async ({ page }) => {
	await page.route('**/api/incidents/index', (r) => r.fulfill({ json: DEMO }));
	await page.goto('/incidents');

	await expect(page.getByRole('article')).toHaveCount(2);
	// Honest labels, region name mapping.
	await expect(page.getByText('Verified by our team')).toBeVisible();
	await expect(page.getByText('Confirmed by people nearby')).toBeVisible();
	await expect(page.getByRole('article').first()).toContainText('Delhi');

	// Category filter narrows to one.
	await page.getByRole('button', { name: 'Detention / arrest' }).click();
	await expect(page.getByRole('article')).toHaveCount(1);
	await expect(page.getByRole('article').first()).toContainText('Detention / arrest');

	// Reset, then client-side search.
	await page.getByRole('button', { name: 'All', exact: true }).click();
	await expect(page.getByRole('article')).toHaveCount(2);
	await page.getByPlaceholder('Search incidents').fill('tear gas');
	await expect(page.getByRole('article')).toHaveCount(1);
	await expect(page.getByRole('article').first()).toContainText('Tear gas');
});
