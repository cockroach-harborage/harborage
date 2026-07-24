import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test('exporting saves a share bundle containing the pack', async ({ page }) => {
	await page.goto('/settings/share-pack');
	const [download] = await Promise.all([
		page.waitForEvent('download'),
		page.getByRole('button', { name: 'Save to share' }).click()
	]);
	expect(download.suggestedFilename()).toBe('harborage-safety-content.json');
	const path = await download.path(); // waits for completion, robust in the full suite
	const bundle = JSON.parse(readFileSync(path, 'utf8'));
	expect(bundle.format).toBe('harborage-share/v1');
	expect(bundle.pack).toContain('harborage-pack/v1');
});

test('importing an unsigned pack is accepted as readable but NOT verified', async ({ page }) => {
	await page.goto('/settings/share-pack');
	// A structurally valid pack with an empty signature (the M1 state / any
	// untrusted copy) must read as "not verified", never as trusted.
	const pack = JSON.stringify({
		format: 'harborage-pack/v1',
		name: 'x',
		epoch: 1,
		manifest: {},
		files: {}
	});
	const bundle = JSON.stringify({ format: 'harborage-share/v1', pack, sig: '' });
	await page.setInputFiles('input[type="file"]', {
		name: 'shared.json',
		mimeType: 'application/json',
		buffer: Buffer.from(bundle)
	});
	await expect(page.getByText('Not verified.')).toBeVisible();
});

test('importing a non-pack file is rejected', async ({ page }) => {
	await page.goto('/settings/share-pack');
	await page.setInputFiles('input[type="file"]', {
		name: 'junk.json',
		mimeType: 'application/json',
		buffer: Buffer.from('this is not a pack')
	});
	await expect(page.getByText('not a Harborage content file')).toBeVisible();
});
