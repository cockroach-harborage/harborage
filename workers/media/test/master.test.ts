/**
 * The server-side archive master (ARCHITECTURE §16 Lever 2).
 *
 * The properties worth guarding: an oversize or failing transform is a SKIP and
 * never an error, the vault bucket is never named on this path, and a missing
 * binding closes only this route.
 */
import { describe, expect, it } from 'vitest';
import { app } from '../src/app.ts';

function flags(on: Record<string, boolean>) {
	return {
		get: async (k: string) =>
			on[k.replace('flag:', '')]
				? JSON.stringify({ enabled: true, epoch: 1, updatedAt: '2026-07-25' })
				: null
	};
}
const rateLimit = {
	idFromName: (n: string) => n,
	get: () => ({ allow: async () => true, admit: async () => 'ok' })
};
const creds = {
	R2_ACCOUNT_ID: 'acct',
	R2_PRESIGN_ACCESS_KEY_ID: 'key',
	R2_PRESIGN_SECRET_ACCESS_KEY: 'secret'
};
const SHA = 'd'.repeat(64);

function env(over: Record<string, unknown> = {}) {
	return {
		FLAGS: flags({ document_intake: true, archive_publish: true }),
		RATE_LIMIT: rateLimit,
		...creds,
		...over
	} as never;
}

async function post(body: unknown, e: unknown) {
	return app.request(
		'/media/master',
		{ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
		e as never
	);
}

describe('the master route stays closed unless everything is ready', () => {
	it('reports not open when the Images binding is absent', async () => {
		// An account without Images must keep uploading evidence: the master is an
		// optimisation, not a custody step.
		const res = await post({ derivative_sha256: SHA }, env());
		expect(res.status).toBe(403);
	});

	it('refuses while archive_publish is off', async () => {
		const res = await post(
			{ derivative_sha256: SHA },
			env({ FLAGS: flags({ document_intake: true }), IMAGES: {} })
		);
		expect(res.status).toBe(403);
	});

	it('refuses while document_intake is off', async () => {
		const res = await post(
			{ derivative_sha256: SHA },
			env({ FLAGS: flags({ archive_publish: true }), IMAGES: {} })
		);
		expect(res.status).toBe(403);
	});

	it('refuses without presign credentials', async () => {
		const res = await post(
			{ derivative_sha256: SHA },
			{
				FLAGS: flags({ document_intake: true, archive_publish: true }),
				RATE_LIMIT: rateLimit,
				IMAGES: {}
			} as never
		);
		expect(res.status).toBe(403);
	});

	it('refuses a malformed digest', async () => {
		const res = await post({ derivative_sha256: 'nope' }, env({ IMAGES: {} }));
		// 400 or 401: the shape is wrong either way, and never 200.
		expect(res.status).not.toBe(200);
	});
});

describe('the master path never names the vault', () => {
	it('reads and writes only the public media bucket', async () => {
		const source = await import('node:fs/promises').then((fs) =>
			fs.readFile(new URL('../src/app.ts', import.meta.url), 'utf8')
		);
		const master = source.slice(source.indexOf("app.post('/media/master'"), source.indexOf("// --- Vault original"));
		expect(master).toContain('PUBLIC_MEDIA_BUCKET');
		expect(master).not.toContain('EVIDENCE_VAULT_BUCKET');
	});

	it('never uses the hosted Images namespace, which needs a paid plan', async () => {
		const source = await import('node:fs/promises').then((fs) =>
			fs.readFile(new URL('../src/app.ts', import.meta.url), 'utf8')
		);
		expect(source).not.toContain('IMAGES.hosted');
	});
});
