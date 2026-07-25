/**
 * Onion-origin classification (ARCHITECTURE §9.2).
 *
 * The property that matters most is the resting one: with no operated origin
 * and no ingress key, EVERY request is clearnet and every onion-only route
 * refuses. A test that only covered the happy path would let a regression open
 * medical brokering over clearnet silently.
 */
import { describe, expect, it } from 'vitest';
import {
	classifyOrigin,
	ONION_CONTEXT,
	ONION_HEADER,
	ONION_WINDOW_MS,
	requireOnionOrigin
} from '../src/onion.ts';

const KEY = 'ingress-key-for-tests';
const NOW = 1_700_000_000_000;
const URL_ = 'https://example.org/api/medical/need';

function b64u(b: Uint8Array): string {
	let s = '';
	for (const x of b) s += String.fromCharCode(x);
	return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

async function assertion(opts: {
	key?: string;
	method?: string;
	path?: string;
	body?: Uint8Array;
	ts?: number;
}): Promise<string> {
	const ts = opts.ts ?? NOW;
	const head = new Uint8Array(8);
	new DataView(head.buffer).setBigUint64(0, BigInt(ts));
	const enc = new TextEncoder();
	const parts = [
		enc.encode(ONION_CONTEXT),
		enc.encode(opts.method ?? 'POST'),
		enc.encode(opts.path ?? '/api/medical/need'),
		opts.body ?? new Uint8Array(32),
		head
	];
	const len = parts.reduce((n, p) => n + p.length, 0);
	const msg = new Uint8Array(len);
	let at = 0;
	for (const p of parts) {
		msg.set(p, at);
		at += p.length;
	}
	const mac = await crypto.subtle.importKey(
		'raw',
		enc.encode(opts.key ?? KEY),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const sig = new Uint8Array(await crypto.subtle.sign('HMAC', mac, msg));
	const out = new Uint8Array(40);
	out.set(head, 0);
	out.set(sig, 8);
	return b64u(out);
}

function req(header: string | null, url = URL_, method = 'POST') {
	return { method, url, headers: { get: (n: string) => (n === ONION_HEADER ? header : null) } };
}

describe('with no operated onion origin', () => {
	it('classifies every request as clearnet when the ingress key is unset', async () => {
		const valid = await assertion({});
		expect(await classifyOrigin(req(valid), new Uint8Array(32), {}, NOW)).toBe('clearnet');
	});

	it('refuses an onion-only route for everyone, on every network', async () => {
		const res = await requireOnionOrigin(req(await assertion({})), new Uint8Array(32), {}, NOW);
		expect(res).not.toBeNull();
		expect(res!.status).toBe(403);
	});
});

describe('a client cannot claim to be onion', () => {
	const env = { ONION_INGRESS_MAC_KEY: KEY };

	it('refuses a request with no header', async () => {
		expect(await classifyOrigin(req(null), new Uint8Array(32), env, NOW)).toBe('clearnet');
	});

	it('refuses a made-up header', async () => {
		expect(await classifyOrigin(req('bm90LWEtbWFj'), new Uint8Array(32), env, NOW)).toBe('clearnet');
	});

	it('refuses an assertion made with a different key', async () => {
		const forged = await assertion({ key: 'some-other-key' });
		expect(await classifyOrigin(req(forged), new Uint8Array(32), env, NOW)).toBe('clearnet');
	});

	it('accepts a genuine assertion', async () => {
		// The negative control. Without this, every refusal above could be a
		// refusal of everything.
		const good = await assertion({});
		expect(await classifyOrigin(req(good), new Uint8Array(32), env, NOW)).toBe('onion');
		expect(await requireOnionOrigin(req(good), new Uint8Array(32), env, NOW)).toBeNull();
	});
});

describe('an assertion cannot be moved or replayed', () => {
	const env = { ONION_INGRESS_MAC_KEY: KEY };

	it('does not verify against a different body', async () => {
		const good = await assertion({ body: new Uint8Array(32).fill(1) });
		expect(await classifyOrigin(req(good), new Uint8Array(32).fill(2), env, NOW)).toBe('clearnet');
	});

	it('does not verify against a different path', async () => {
		const good = await assertion({ path: '/api/medical/need' });
		const moved = req(good, 'https://example.org/api/aid/need');
		expect(await classifyOrigin(moved, new Uint8Array(32), env, NOW)).toBe('clearnet');
	});

	it('does not verify against a different method', async () => {
		const good = await assertion({ method: 'POST' });
		expect(await classifyOrigin(req(good, URL_, 'GET'), new Uint8Array(32), env, NOW)).toBe(
			'clearnet'
		);
	});

	it('refuses an assertion from outside the window', async () => {
		const stale = await assertion({ ts: NOW - ONION_WINDOW_MS - 1000 });
		expect(await classifyOrigin(req(stale), new Uint8Array(32), env, NOW)).toBe('clearnet');
		const future = await assertion({ ts: NOW + ONION_WINDOW_MS + 1000 });
		expect(await classifyOrigin(req(future), new Uint8Array(32), env, NOW)).toBe('clearnet');
	});

	it('accepts one at the edge of the window, so the bound is the stated one', async () => {
		const edge = await assertion({ ts: NOW - ONION_WINDOW_MS + 1000 });
		expect(await classifyOrigin(req(edge), new Uint8Array(32), env, NOW)).toBe('onion');
	});
});
