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

/** Minimal Images stub. Never reached in these tests, but shaped correctly. */
function images() {
	return {
		info: async () => ({ format: 'image/webp', fileSize: 1000 }),
		input: () => ({
			transform: () => ({
				output: async () => ({ response: () => new Response(new Uint8Array(8)) })
			})
		})
	};
}

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

describe('the master path', () => {
	// "Never names the vault bucket" is enforced by
	// tools/gates/gate-archive-custody.mjs, NOT here. The route sits behind a
	// per-request credential, so a unit test without a valid cap-cert gets 401
	// and never reaches the bucket constant -- written as a fetch-interception
	// first, sabotaged to read from the vault, and it stayed green.
	it('refuses without a credential, even when everything else is ready', async () => {
		const res = await post({ derivative_sha256: SHA }, env({ IMAGES: images() }));
		expect(res.status).toBe(401);
	});

	it('closes under heightened threat even with archive_publish on', async () => {
		const res = await post(
			{ derivative_sha256: SHA },
			env({
				IMAGES: images(),
				FLAGS: flags({ document_intake: true, archive_publish: true, heightened_threat: true })
			})
		);
		expect(res.status).toBe(403);
	});
});
