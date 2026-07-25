/**
 * The medical routes reject non-sealed bodies, PAST the onion guard.
 *
 * WHY EVERY TEST HERE FORGES A REAL INGRESS ASSERTION. On an onion-only route
 * every refusal is 403, so a sealed-body test written the ordinary way sees 403
 * for the wrong reason and passes with the framing checks entirely deleted.
 * That is the "401 fired before the code under test" bug wearing a new costume,
 * and gate-sealed-body now requires a non-403 4xx on an onion entry precisely
 * so this file cannot be written the lazy way.
 *
 * Reaching a 400 or a 415 therefore proves two things at once: the guard let a
 * properly-asserted request through, and the framing check behind it fired.
 */
import { describe, expect, it } from 'vitest';
import { app } from '../src/app.ts';
import {
	ALG_SEALED_BOX_X25519,
	ALG_VAULT_KEYRING,
	frameEnvelope
} from '@harborage/worker-lib/envelope';
import { BROKER_FRAME_LEN, buildBrokerFrame } from '@harborage/worker-lib/broker';
import { onionHeader } from './medical.onion-only.test.ts';

const MAC = 'medical-sealed-body-test-key';

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

/**
 * Only the ingress key is present. Every structural rejection below happens
 * before the flag is read, so nothing else is needed — and if that ever stops
 * being true, these throw rather than passing quietly.
 */
function onionEnv() {
	return new Proxy(
		{ ONION_INGRESS_MAC_KEY: MAC },
		{
			get(t: Record<string, unknown>, prop: string) {
				if (prop === 'ONION_INGRESS_MAC_KEY') return t[prop];
				throw new Error(`touched binding ${prop} before the structural checks finished`);
			}
		}
	) as never;
}

async function postOnion(path: string, body: Uint8Array, contentType = 'application/octet-stream') {
	const header = await onionHeader(MAC, 'POST', path, body);
	return app.request(
		path,
		{ method: 'POST', headers: { 'content-type': contentType, 'X-HB-Onion': header }, body },
		onionEnv()
	);
}

describe.each(ROUTES)('%s rejects non-sealed bodies past the guard', (path) => {
	/**
	 * The content-type check runs BEFORE the origin check, because verifying the
	 * assertion means hashing the body and an unbounded body on an unauthenticated
	 * route is its own problem. So this one needs no assertion.
	 */
	it('rejects a plain JSON body with exactly 415, before the guard', async () => {
		const res = await app.request(
			path,
			{ method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"need":"help"}' },
			onionEnv()
		);
		expect(res.status).toBe(415);
		expect(await res.text()).toBe('sealed envelope required');
	});

	it('rejects a frame one byte short with exactly 400', async () => {
		const res = await postOnion(path, new Uint8Array(BROKER_FRAME_LEN - 1));
		expect(res.status).toBe(400);
		expect(await res.text()).toBe('sealed envelope required');
	});

	it('rejects a right-sized body with no envelope header with exactly 400', async () => {
		const res = await postOnion(path, new Uint8Array(BROKER_FRAME_LEN));
		expect(res.status).toBe(400);
	});

	it('rejects a right-sized body framed for a different lane with exactly 400', async () => {
		for (const alg of [ALG_SEALED_BOX_X25519, ALG_VAULT_KEYRING]) {
			const wrong = frameEnvelope(new Uint8Array(BROKER_FRAME_LEN - 5), alg);
			const res = await postOnion(path, wrong);
			expect(res.status, `alg ${alg}`).toBe(400);
		}
	});

	/**
	 * The assertion binds the BODY. Reusing one over different bytes must fail, or
	 * an intercepted header would be a reusable pass for any payload.
	 */
	it('refuses an assertion computed over different bytes, with 403', async () => {
		const a = buildBrokerFrame({
			region: 'IN-DL',
			category: 'food',
			sealed: new Uint8Array(3000).fill(1)
		});
		const b = buildBrokerFrame({
			region: 'IN-DL',
			category: 'food',
			sealed: new Uint8Array(3000).fill(9)
		});
		const header = await onionHeader(MAC, 'POST', path, a);
		const res = await app.request(
			path,
			{
				method: 'POST',
				headers: { 'content-type': 'application/octet-stream', 'X-HB-Onion': header },
				body: b
			},
			onionEnv()
		);
		expect(res.status).toBe(403);
	});

	/**
	 * The assertion binds the PATH, so one route's header cannot be replayed onto
	 * another. Without this, a captured standby assertion would open the accept
	 * route.
	 */
	it('refuses an assertion computed for a different path, with 403', async () => {
		const body = buildBrokerFrame({
			region: 'IN-DL',
			category: 'food',
			sealed: new Uint8Array(3000).fill(2)
		});
		// A decoy that is never the route under test, so the assertion can never
		// legitimately match. An earlier version computed the header for a fixed
		// path and posted to it in four of five cases, where the assertion was
		// VALID: the guard let it through and the tripwire env threw. A 500 rather
		// than the expected 403 is what surfaced it.
		const wrongPath = path === '/api/medical/poll' ? '/api/medical/send' : '/api/medical/poll';
		const header = await onionHeader(MAC, 'POST', wrongPath, body);
		const res = await app.request(
			path,
			{
				method: 'POST',
				headers: { 'content-type': 'application/octet-stream', 'X-HB-Onion': header },
				body
			},
			onionEnv()
		);
		expect(res.status).toBe(403);
	});
});
