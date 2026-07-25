import { expect, test, type Page } from '@playwright/test';
import { longestSharedRun, syntheticImage } from './helpers/synthetic-image';

/**
 * The ARCHITECTURE §18.5-P2 pixel test, run against the REAL on-device pipeline
 * in a real browser: the same-origin module worker under strict CSP, the real
 * decode/downscale/bake/encode path, and the exact bytes the human approved.
 *
 * It backs two different claims, which §19:1319 is careful to keep apart:
 *
 *  - CONFIDENTIALITY: "the public derivative never contains the vault original's
 *    bytes". Checked on the byte stream, plus a metadata canary planted in the
 *    original that must not survive the re-encode.
 *  - COVER COMPLETENESS: the confirmed regions really are irreversible solid
 *    fill in the shipped bytes, not merely drawn on a preview canvas.
 *
 * A pixel test with no negative control is decoration: an all-black derivative
 * would pass "the covered area is black" trivially. So every assertion that a
 * region IS fill is paired with an assertion that a region OUTSIDE the box is
 * NOT fill, in the same image, from the same bytes.
 *
 * TWO THINGS THIS TEST DELIBERATELY DOES NOT DO, both discovered by running it:
 *
 *  1. It does not `fetch()` the blob: URL the confirm screen is displaying. The
 *     app's CSP is `connect-src 'self' https://*.r2.cloudflarestorage.com`, so
 *     that fetch is blocked -- correctly. Widening `connect-src` to `blob:` to
 *     make a test convenient would weaken the real policy on a browser-crypto
 *     PWA, where an XSS exfiltrates over exactly that directive.
 *  2. It therefore reads the bytes back from IndexedDB after commit, which is
 *     the stronger assertion anyway: it checks the artifact that was STORED and
 *     would be sent, not merely the one that was rendered.
 */

/** Matches FILL_TOLERANCE in derivative-core.ts. */
const FILL_TOLERANCE = 24;

/** Normalized drag, in canvas coordinates. */
const BOX = { x0: 0.25, y0: 0.25, x1: 0.6, y1: 0.6 };

interface Pixels {
	width: number;
	height: number;
	/** Sampled [r,g,b] triples, well inside the drawn box. */
	covered: number[][];
	/** Sampled [r,g,b] triples, far outside the drawn box, in both corners. */
	outside: number[][];
}

function isFill(px: number[]): boolean {
	return px[0]! <= FILL_TOLERANCE && px[1]! <= FILL_TOLERANCE && px[2]! <= FILL_TOLERANCE;
}

/** Drive the flow to the confirm screen with one cover box drawn. */
async function coverAndContinue(page: Page, buffer: Buffer) {
	await page.goto('/document/new');
	await page.getByRole('button', { name: 'Add a photo' }).click();
	await page.setInputFiles('input[type="file"]', {
		name: 'capture.png',
		mimeType: 'image/png',
		buffer
	});

	// The canvas is not interactive until the capture has decoded; a drag before
	// that silently does nothing. aria-busy is how the component says so.
	const canvas = page.locator('canvas[aria-busy="false"]');
	await expect(canvas).toBeVisible();
	const bb = (await canvas.boundingBox())!;
	await page.mouse.move(bb.x + bb.width * BOX.x0, bb.y + bb.height * BOX.y0);
	await page.mouse.down();
	await page.mouse.move(bb.x + bb.width * BOX.x1, bb.y + bb.height * BOX.y1, { steps: 12 });
	await page.mouse.up();
	await expect(page.getByText('1 covered')).toBeVisible();

	await page.getByRole('button', { name: 'Yes, hide and continue' }).click();
	await expect(page.getByRole('heading', { name: 'Check the covered copy' })).toBeVisible();
}

/**
 * Sample the derivative the confirm screen is showing, by drawing the <img>
 * element itself to a canvas. No network request, so no CSP interaction.
 */
async function shownPixels(page: Page): Promise<Pixels> {
	return page.evaluate(async () => {
		const img = document.querySelector('img.shot') as HTMLImageElement;
		await img.decode();
		const c = document.createElement('canvas');
		c.width = img.naturalWidth;
		c.height = img.naturalHeight;
		const ctx = c.getContext('2d', { willReadFrequently: true })!;
		ctx.drawImage(img, 0, 0);

		const sample = (x0: number, y0: number, x1: number, y1: number) => {
			const out: number[][] = [];
			for (let i = 0; i <= 4; i++) {
				for (let j = 0; j <= 4; j++) {
					const px = Math.round((x0 + ((x1 - x0) * i) / 4) * (c.width - 1));
					const py = Math.round((y0 + ((y1 - y0) * j) / 4) * (c.height - 1));
					const d = ctx.getImageData(px, py, 1, 1).data;
					out.push([d[0]!, d[1]!, d[2]!]);
				}
			}
			return out;
		};

		return {
			width: c.width,
			height: c.height,
			// Well inside the 0.25-0.60 drag, clear of lossy edge ringing.
			covered: sample(0.32, 0.32, 0.53, 0.53),
			// Top-left and bottom-right, far outside it, so a box that swallowed
			// the whole frame cannot pass.
			outside: [...sample(0.03, 0.03, 0.15, 0.15), ...sample(0.8, 0.8, 0.96, 0.96)]
		};
	});
}

/** Finish the flow so the artifact is committed to IndexedDB. */
async function commit(page: Page) {
	await page.getByRole('button', { name: 'Yes, this is safe to share' }).click();
	await page.getByRole('button', { name: 'Keep on phone' }).click();
	await expect(page.getByRole('heading', { name: 'Saved on this phone' })).toBeVisible();
}

/** The exact derivative bytes that were STORED, read straight out of IndexedDB. */
async function storedDerivative(page: Page): Promise<Buffer> {
	const b64 = await page.evaluate(async () => {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const r = indexedDB.open('harborage-records');
			r.onsuccess = () => resolve(r.result);
			r.onerror = () => reject(r.error);
		});
		const rows = await new Promise<{ createdAt: number; derivative?: { blob: Blob } }[]>(
			(resolve, reject) => {
				const r = db.transaction('records').objectStore('records').getAll();
				r.onsuccess = () => resolve(r.result);
				r.onerror = () => reject(r.error);
			}
		);
		db.close();
		const newest = rows.sort((a, b) => b.createdAt - a.createdAt)[0];
		if (!newest?.derivative) return '';
		const bytes = new Uint8Array(await newest.derivative.blob.arrayBuffer());
		// Chunked: String.fromCharCode(...bigArray) blows the argument limit.
		let bin = '';
		for (let i = 0; i < bytes.length; i += 8192)
			bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
		return btoa(bin);
	});
	return Buffer.from(b64, 'base64');
}

test('the covered region is solid fill in the bytes the human approved', async ({ page }) => {
	const src = syntheticImage();
	await coverAndContinue(page, src.buffer);
	const px = await shownPixels(page);

	for (const p of px.covered) expect(isFill(p), `covered pixel ${p}`).toBe(true);

	// NEGATIVE CONTROL. Without this, an all-black derivative would satisfy the
	// assertion above and the test would be worthless.
	expect(px.outside.length).toBeGreaterThan(0);
	for (const p of px.outside) expect(isFill(p), `pixel outside the box ${p}`).toBe(false);
});

test('the stored public copy carries none of the original bytes or metadata', async ({ page }) => {
	const src = syntheticImage();
	await coverAndContinue(page, src.buffer);
	await commit(page);
	const derivative = await storedDerivative(page);

	expect(derivative.length).toBeGreaterThan(0);

	// The canary lives in a PNG tEXt chunk on the original. Re-encoding through a
	// canvas drops all metadata by construction; this proves it rather than
	// trusting it.
	expect(src.buffer.includes(Buffer.from(src.canary, 'latin1'))).toBe(true);
	expect(derivative.includes(Buffer.from(src.canary, 'latin1'))).toBe(false);

	// No meaningful run of the original's bytes survives into the public copy:
	// no embedded thumbnail, no appended original, no passthrough.
	expect(longestSharedRun(src.buffer, derivative)).toBeLessThan(64);

	// Different bytes entirely. This is only an "an encode actually ran" check
	// (§19:1319), never the cover guarantee -- that is the pixel test above.
	expect(derivative.equals(src.buffer)).toBe(false);
});

test('the derivative is downscaled and stays above the legibility floor', async ({ page }) => {
	const src = syntheticImage();
	await coverAndContinue(page, src.buffer);
	const px = await shownPixels(page);

	const longEdge = Math.max(px.width, px.height);
	expect(longEdge).toBeLessThan(Math.max(src.width, src.height));
	// The floor is a floor: a badge number or banner must stay readable.
	expect(longEdge).toBeGreaterThanOrEqual(1280);
});

test('going back to cover more re-renders rather than showing the old bytes', async ({ page }) => {
	const src = syntheticImage();
	await coverAndContinue(page, src.buffer);
	const first = await shownPixels(page);
	// The bottom-right corner is untouched by the first box.
	expect(first.outside.slice(25).some(isFill)).toBe(false);

	await page.getByRole('button', { name: 'Go back and cover more' }).click();
	const canvas = page.locator('canvas[aria-busy="false"]');
	await expect(canvas).toBeVisible();
	const bb = (await canvas.boundingBox())!;
	await page.mouse.move(bb.x + bb.width * 0.72, bb.y + bb.height * 0.72);
	await page.mouse.down();
	await page.mouse.move(bb.x + bb.width * 0.99, bb.y + bb.height * 0.99, { steps: 8 });
	await page.mouse.up();
	await expect(page.getByText('2 covered')).toBeVisible();

	await page.getByRole('button', { name: 'Yes, hide and continue' }).click();
	await expect(page.getByRole('heading', { name: 'Check the covered copy' })).toBeVisible();
	const second = await shownPixels(page);

	// The region covered only on the second pass is now fill, and the first box
	// still is. A stale render on the confirm screen is exactly what this catches.
	for (const p of second.outside.slice(25)) expect(isFill(p), `second box ${p}`).toBe(true);
	for (const p of second.covered) expect(isFill(p), `first box still ${p}`).toBe(true);
	// The top-left corner was never covered in either pass.
	for (const p of second.outside.slice(0, 25)) expect(isFill(p), `untouched ${p}`).toBe(false);
});

test('a photo that cannot be decoded here cannot produce a public copy', async ({ page }) => {
	await page.goto('/document/new');
	await page.getByRole('button', { name: 'Add a photo' }).click();
	await page.setInputFiles('input[type="file"]', {
		name: 'broken.png',
		mimeType: 'image/png',
		buffer: Buffer.from('not a real png at all, just bytes', 'latin1')
	});
	// Fail closed: with no pixels we can neither build nor verify a covered copy,
	// so the only honest path left is vault-only.
	await expect(page.getByText('This photo could not open here')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Yes, hide and continue' })).toBeDisabled();
	await expect(page.getByRole('button', { name: 'Keep private only' })).toBeEnabled();
});
