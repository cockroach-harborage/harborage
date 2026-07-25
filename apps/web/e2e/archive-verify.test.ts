import { expect, test, type Page } from '@playwright/test';

/**
 * The independent verifier (ARCHITECTURE §7.2, §16).
 *
 * Its promise is that it trusts nothing we serve, so the load-bearing test is
 * that checking a proof makes NO request to us at all. A verifier that phoned
 * home would be a closed loop proving nothing.
 */

/** Build a valid record + single-sibling proof entirely in the page. */
async function validBundle(page: Page): Promise<string> {
	return page.evaluate(async () => {
		const enc = new TextEncoder();
		const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
		const unhex = (s: string) => {
			const o = new Uint8Array(s.length / 2);
			for (let i = 0; i < o.length; i++) o[i] = Number.parseInt(s.slice(i * 2, i * 2 + 2), 16);
			return o;
		};
		const sha = async (...parts: Uint8Array[]) => {
			const len = parts.reduce((n, p) => n + p.length, 0);
			const buf = new Uint8Array(len);
			let at = 0;
			for (const p of parts) {
				buf.set(p, at);
				at += p.length;
			}
			return new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
		};
		const anchor = 'a'.repeat(64);
		const prevHash = '00'.repeat(32);
		const mk = async (detail: string) => {
			const canonical = `{"actorBand":"system","anchor":"${anchor}","atBucket":"2026-07-25","detail":"${detail}","event":"ingest"}`;
			return {
				seq: 1,
				event: 'ingest',
				actorBand: 'system',
				detail,
				atBucket: '2026-07-25',
				anchor,
				prevHash,
				recordHash: hex(await sha(unhex(prevHash), enc.encode(canonical)))
			};
		};
		const a = await mk('a');
		const b = await mk('b');
		const leafA = await sha(new Uint8Array([0x00]), unhex(a.recordHash));
		const leafB = await sha(new Uint8Array([0x00]), unhex(b.recordHash));
		const root = hex(await sha(new Uint8Array([0x01]), leafA, leafB));
		return JSON.stringify({ record: a, path: [{ hash: hex(leafB), right: true }], root });
	});
}

test('a pasted proof verifies with no request to us', async ({ page }) => {
	const ours: string[] = [];
	page.on('request', (r) => {
		const url = new URL(r.url());
		if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/')) ours.push(url.pathname);
	});

	await page.goto('/archive/verify');
	const bundle = await validBundle(page);
	await page.getByTestId('proof-input').fill(bundle);
	await page.getByTestId('verify-go').click();

	await expect(page.getByTestId('verify-result')).toContainText('matches the proof');
	expect(ours).toEqual([]);
});

test('every success says nothing outside our system has confirmed it', async ({ page }) => {
	await page.goto('/archive/verify');
	await page.getByTestId('proof-input').fill(await validBundle(page));
	await page.getByTestId('verify-go').click();
	await expect(page.getByTestId('verify-anchor-note')).toContainText('Nothing outside our system');
});

test('a tampered record shows a plain failure, not a green check', async ({ page }) => {
	await page.goto('/archive/verify');
	const bundle = JSON.parse(await validBundle(page));
	bundle.record.detail = 'rewritten after the fact';
	await page.getByTestId('proof-input').fill(JSON.stringify(bundle));
	await page.getByTestId('verify-go').click();

	const result = page.getByTestId('verify-result');
	await expect(result).toContainText('does not match its own hash');
	await expect(result).not.toContainText('matches the proof');
});

test('a proof that does not reach the root is refused', async ({ page }) => {
	await page.goto('/archive/verify');
	const bundle = JSON.parse(await validBundle(page));
	bundle.path[0].right = false;
	await page.getByTestId('proof-input').fill(JSON.stringify(bundle));
	await page.getByTestId('verify-go').click();
	await expect(page.getByTestId('verify-result')).toContainText('does not reach the root');
});

test('no copy on the page promises a court will accept anything', async ({ page }) => {
	for (const path of ['/archive/verify', '/hi/archive/verify', '/limits', '/hi/limits']) {
		await page.goto(path);
		const text = (await page.locator('body').innerText()).toLowerCase();
		for (const overclaim of ['admissible', 'legally valid', 'proof in court', 'court will accept']) {
			expect(text, `${path} must not say "${overclaim}"`).not.toContain(overclaim);
		}
	}
});

test('the verifier works offline from the saved copy', async ({ page, context }) => {
	// The honest form of "trusts nothing we serve": a reader can keep this page
	// and run it later against a proof from any source.
	await page.goto('/archive/verify');
	await page.evaluate(() => navigator.serviceWorker.ready);
	const bundle = await validBundle(page);

	await context.setOffline(true);
	await page.goto('/archive/verify');
	await page.getByTestId('proof-input').fill(bundle);
	await page.getByTestId('verify-go').click();
	await expect(page.getByTestId('verify-result')).toContainText('matches the proof');
	await context.setOffline(false);
});
