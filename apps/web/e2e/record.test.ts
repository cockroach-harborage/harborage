import { expect, test } from '@playwright/test';

// Keep-on-phone capture (PR 4). These exercise the on-device pipeline end to end:
// the same-origin module worker (loads under strict CSP), client-side seal, and
// the IndexedDB record store. Nothing here contacts the network.

// A valid 2x2 RGB PNG so createImageBitmap / the redaction canvas can decode it.
const PNG_2x2 = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGM4ISd3Qk6OAUIBAB8mBBG4glMAAAAAAElFTkSuQmCC',
	'base64'
);

test('a note record is kept on this phone only', async ({ page }) => {
	await page.goto('/record/new');
	await page.getByRole('button', { name: 'Write a note' }).click();
	await page.getByRole('button', { name: 'Detention / arrest' }).click();
	await page.getByRole('button', { name: 'Keep on phone' }).click();
	await expect(page.getByRole('heading', { name: 'Saved on this phone' })).toBeVisible();
	await page.goto('/record');
	await expect(page.getByText('Detention / arrest')).toBeVisible();
});

test('a photo is sealed on-device with no public copy (keep private only)', async ({ page }) => {
	await page.goto('/record/new');
	await page.getByRole('button', { name: 'Add a photo' }).click();
	await page.setInputFiles('input[type="file"]', {
		name: 'x.png',
		mimeType: 'image/png',
		buffer: PNG_2x2
	});
	// The worker seals the pristine original off the main thread; no derivative.
	await page.getByRole('button', { name: 'Keep private only' }).click();
	await page.getByRole('button', { name: 'Baton charge / beating' }).click();
	await page.getByRole('button', { name: 'Keep on phone' }).click();
	await expect(page.getByRole('heading', { name: 'Saved on this phone' })).toBeVisible();
	await page.goto('/record');
	await expect(page.getByText('Baton charge / beating')).toBeVisible();
	await expect(page.getByText('Private only')).toBeVisible();
});

test('a photo redaction bakes a downscaled public copy (hide and continue)', async ({ page }) => {
	await page.goto('/record/new');
	await page.getByRole('button', { name: 'Add a photo' }).click();
	await page.setInputFiles('input[type="file"]', {
		name: 'x.png',
		mimeType: 'image/png',
		buffer: PNG_2x2
	});
	// The worker strips metadata, bakes solid boxes, downscales, and re-encodes.
	await page.getByRole('button', { name: 'Yes, hide and continue' }).click();
	await expect(page.getByText('Your covered photo is ready.')).toBeVisible();
	await page.getByRole('button', { name: 'Tear gas / crowd-control weapons' }).click();
	await page.getByRole('button', { name: 'Keep on phone' }).click();
	await expect(page.getByRole('heading', { name: 'Saved on this phone' })).toBeVisible();
	await page.goto('/record');
	await expect(page.getByText('Tear gas / crowd-control weapons')).toBeVisible();
	// A redacted record shows its covered thumbnail, not the "Private only" note.
	await expect(page.locator('img.rec-thumb')).toBeVisible();
});
