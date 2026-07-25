/**
 * Network stubs for the send path (ARCHITECTURE §19).
 *
 * Two details here are the whole reason a real multipart upload works, and
 * getting either wrong makes every vault upload uncompletable:
 *
 * 1. Part URLs must be under https://*.r2.cloudflarestorage.com. That host is in
 *    the app's own connect-src, and nothing else is. A stub on any other origin
 *    is blocked by CSP and the test fails for a reason that has nothing to do
 *    with the code under test.
 * 2. A cross-origin PUT needs a preflight, and the ETag is unreadable from JS
 *    without `Access-Control-Expose-Headers: ETag`. That is exactly what
 *    infra/r2.tf's CORS rule exists for. Omitting it here produces the same
 *    failure as omitting it in production: putPart throws invalid_part.
 */
import type { Page, Route } from '@playwright/test';

/** The one origin the app's connect-src permits for direct uploads. */
export const R2_STUB_ORIGIN = 'https://stub.r2.cloudflarestorage.com';

export interface VaultCalls {
	creates: number;
	partRequests: number[];
	puts: number[];
	completes: number;
	heads: number;
	aborts: number;
	derivatives: number;
}

export interface VaultOptions {
	/** Status per complete attempt, consumed in order. Defaults to 200 forever. */
	completeStatus?: number[];
	/** Status per (part, attempt). Return null for success. */
	partStatus?: (n: number, attempt: number) => number | null;
	/** Status for /media/create, consumed in order. */
	createStatus?: number[];
	/** Answer for /media/head. */
	objectExists?: boolean;
}

async function corsPreflight(route: Route): Promise<boolean> {
	if (route.request().method() !== 'OPTIONS') return false;
	await route.fulfill({
		status: 204,
		headers: {
			'access-control-allow-origin': '*',
			'access-control-allow-methods': 'PUT, GET, HEAD',
			'access-control-allow-headers': 'content-type, content-length'
		}
	});
	return true;
}

/** Stub every /media/* route plus the direct-to-R2 part PUTs. */
export async function stubVault(page: Page, opts: VaultOptions = {}): Promise<VaultCalls> {
	const calls: VaultCalls = {
		creates: 0,
		partRequests: [],
		puts: [],
		completes: 0,
		heads: 0,
		aborts: 0,
		derivatives: 0
	};
	const partAttempts = new Map<number, number>();

	await page.route('**/media/create', async (route) => {
		const status = opts.createStatus?.shift() ?? 200;
		calls.creates++;
		if (status !== 200) return route.fulfill({ status, json: { error: 'stub' } });
		return route.fulfill({ json: { key: 'stub-vault-key', uploadId: 'stub-upload-1' } });
	});

	await page.route('**/media/part', async (route) => {
		const body = route.request().postDataJSON() as { partNumber: number };
		calls.partRequests.push(body.partNumber);
		return route.fulfill({ json: { url: `${R2_STUB_ORIGIN}/part/${body.partNumber}` } });
	});

	await page.route('**/media/complete', async (route) => {
		const status = opts.completeStatus?.shift() ?? 200;
		calls.completes++;
		if (status !== 200) return route.fulfill({ status, json: { error: 'stub' } });
		return route.fulfill({ json: { ok: true } });
	});

	await page.route('**/media/abort', async (route) => {
		calls.aborts++;
		return route.fulfill({ json: { ok: true } });
	});

	await page.route('**/media/head', async (route) => {
		calls.heads++;
		return route.fulfill({ json: { exists: opts.objectExists ?? false } });
	});

	await page.route('**/media/derivative', async (route) => {
		calls.derivatives++;
		return route.fulfill({ json: { url: `${R2_STUB_ORIGIN}/derivative`, key: 'sha256/ab/abc' } });
	});

	await page.route(`${R2_STUB_ORIGIN}/**`, async (route) => {
		if (await corsPreflight(route)) return;
		const url = new URL(route.request().url());
		const n = Number(url.pathname.split('/').pop());
		if (!Number.isFinite(n)) {
			// The derivative PUT. No ETag needed on this path.
			return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' } });
		}
		const attempt = (partAttempts.get(n) ?? 0) + 1;
		partAttempts.set(n, attempt);
		const failure = opts.partStatus?.(n, attempt) ?? null;
		if (failure !== null) {
			return route.fulfill({
				status: failure,
				headers: { 'access-control-allow-origin': '*' }
			});
		}
		calls.puts.push(n);
		return route.fulfill({
			status: 200,
			headers: {
				'access-control-allow-origin': '*',
				// Without expose-headers the browser hides ETag from JS and every
				// multipart upload is uncompletable. This mirrors infra/r2.tf.
				'access-control-expose-headers': 'ETag',
				etag: `"${'0'.repeat(31)}${n}"`
			}
		});
	});

	return calls;
}

export interface RegisterCalls {
	count: number;
	tokens: (string | null)[];
}

export async function stubRegister(page: Page): Promise<RegisterCalls> {
	const calls: RegisterCalls = { count: 0, tokens: [] };
	await page.route('**/api/incidents/register', async (route) => {
		calls.count++;
		calls.tokens.push(route.request().headerValue ? null : null);
		const headers = route.request().headers();
		calls.tokens[calls.tokens.length - 1] = headers['cf-turnstile-response'] ?? null;
		return route.fulfill({ status: 202, json: { receipt: `receipt-${calls.count}` } });
	});
	return calls;
}

/** Intake status with the flag on and a well-formed key, so a send can proceed. */
export async function stubIntakeOpen(page: Page): Promise<void> {
	await page.route('**/api/intake/status', (route) =>
		route.fulfill({
			json: {
				document_intake: true,
				directory_intake: false,
				intake_key: 'ab'.repeat(32),
				turnstile_sitekey: '1x00000000000000000000AA'
			}
		})
	);
}
