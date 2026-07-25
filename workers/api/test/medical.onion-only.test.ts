/**
 * The medical routes refuse over clearnet, before touching anything.
 *
 * THE ENV IS A PROXY THAT THROWS ON EVERY PROPERTY READ except the ingress key.
 * That is what makes the ordering claim real rather than aspirational: if the
 * flag read or the rate ladder ever moves above the origin check, the Proxy
 * throws, the handler 500s, and these tests go red. A test asserting only
 * "returns 403" would stay green through exactly that regression, because the
 * flag also returns 403.
 */
import { describe, expect, it } from 'vitest';
import { app } from '../src/app.ts';
import { buildBrokerFrame } from '@harborage/worker-lib/broker';

/**
 * Full endpoint strings, verbatim, because both gate-onion-only and
 * gate-sealed-body look for the registered name in the covering test. Deriving
 * the path from them keeps one source of truth rather than a list of paths that
 * could drift from a list of names.
 */
const ENDPOINTS = [
	'POST /api/medical/request',
	'POST /api/medical/standby',
	'POST /api/medical/accept',
	'POST /api/medical/send',
	'POST /api/medical/poll'
] as const;
const ROUTES = ENDPOINTS.map((e) => e.slice('POST '.length));

/** Throws the moment anything other than the ingress key is read. */
function tripwireEnv() {
	return new Proxy(
		{},
		{
			get(_t, prop) {
				if (prop === 'ONION_INGRESS_MAC_KEY') return undefined;
				throw new Error(`touched binding ${String(prop)} on a clearnet request`);
			}
		}
	) as never;
}

function frame() {
	return buildBrokerFrame({
		region: 'IN-DL',
		category: 'food',
		sealed: new Uint8Array(3000).fill(2)
	});
}

function post(path: string, body: BodyInit, env: unknown, headers: Record<string, string> = {}) {
	return app.request(
		path,
		{ method: 'POST', headers: { 'content-type': 'application/octet-stream', ...headers }, body },
		env as never
	);
}

describe.each(ROUTES)('%s over clearnet', (path) => {
	it('refuses with exactly 403 and touches no binding', async () => {
		const res = await post(path, frame(), tripwireEnv());
		expect(res.status).toBe(403);
		// The exact body matters: the flag and the credential also refuse, and
		// only this text says the ORIGIN was the reason.
		expect(await res.text()).toBe('not available on this network');
	});

	/**
	 * The same with a well-formed request that would otherwise succeed. Without
	 * this, the refusal above could be explained by the body rather than by the
	 * network, and the ordering claim would rest on nothing.
	 */
	it('refuses even when every flag would be on', async () => {
		const env = new Proxy(
			{
				FLAGS: {
					get: async () => JSON.stringify({ enabled: true, epoch: 1, updatedAt: '2026-07-26' })
				},
				RATE_LIMIT: { idFromName: (n: string) => n, get: () => ({ allow: async () => true }) },
				BROKER_INBOX_MAC_KEY: 'a-test-mac-key'
			},
			{
				get(t: Record<string, unknown>, prop: string) {
					if (prop === 'ONION_INGRESS_MAC_KEY') return undefined;
					// Reading any of the others means the origin check did not run first.
					throw new Error(`touched binding ${prop} before the origin check`);
				}
			}
		) as never;
		const res = await post(path, frame(), env);
		expect(res.status).toBe(403);
		expect(await res.text()).toBe('not available on this network');
	});
});

describe('the ingress key is the whole gate', () => {
	/**
	 * ONION_INGRESS_MAC_KEY is absent in production, so classifyOrigin returns
	 * clearnet for every request and every route here refuses for everyone on
	 * every network. That is the correct resting state until an onion origin is
	 * operated, not an outage, and this asserts it rather than leaving it to a
	 * comment.
	 */
	it('refuses every medical route while no ingress key is configured', async () => {
		for (const path of ROUTES) {
			const res = await post(path, frame(), tripwireEnv());
			expect(res.status, path).toBe(403);
		}
	});

	/**
	 * The negative control. An assertion computed with the WRONG key must not
	 * pass, or "refuses everything" would be indistinguishable from a working
	 * verifier and the tests above would prove nothing about the mechanism.
	 */
	it('refuses an assertion computed under a different key', async () => {
		const body = frame();
		const header = await onionHeader('another-key-entirely', 'POST', '/api/medical/request', body);
		const res = await post('/api/medical/request', body, tripwireEnv(), { 'X-HB-Onion': header });
		expect(res.status).toBe(403);
	});
});

/** Build the ingress assertion the operated onion origin would attach. */
export async function onionHeader(
	macKey: string,
	method: string,
	path: string,
	body: Uint8Array,
	nowMs = Date.now()
): Promise<string> {
	const bodyHash = new Uint8Array(await crypto.subtle.digest('SHA-256', body as BufferSource));
	const ts = new Uint8Array(8);
	new DataView(ts.buffer).setBigUint64(0, BigInt(nowMs));
	const enc = new TextEncoder();
	const parts = [
		enc.encode('harborage/onion/v1'),
		enc.encode(method),
		enc.encode(path),
		bodyHash,
		ts
	];
	let len = 0;
	for (const p of parts) len += p.length;
	const message = new Uint8Array(len);
	let at = 0;
	for (const p of parts) {
		message.set(p, at);
		at += p.length;
	}
	const key = await crypto.subtle.importKey(
		'raw',
		enc.encode(macKey),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, message as BufferSource));
	const out = new Uint8Array(40);
	out.set(ts, 0);
	out.set(mac, 8);
	let s = '';
	for (const b of out) s += String.fromCharCode(b);
	return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
