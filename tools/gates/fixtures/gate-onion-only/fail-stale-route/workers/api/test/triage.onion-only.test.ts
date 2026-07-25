import { describe, expect, it } from 'vitest';
import { app } from '../src/app.ts';

// The env is a Proxy that throws on any property read. A clearnet request to
// "POST /api/things/triage" must be refused before any binding is touched, so if
// the origin check ever moves below the flag read this test throws instead of
// returning 403.
const noEnv = new Proxy(
	{},
	{
		get(_t, prop) {
			if (prop === 'ONION_INGRESS_MAC_KEY') return undefined;
			throw new Error(`touched binding ${String(prop)} on a clearnet request`);
		}
	}
) as never;

describe('POST /api/things/triage refuses over clearnet', () => {
	it('returns 403 and touches no binding', async () => {
		const res = await app.request(
			'/api/things/triage',
			{
				method: 'POST',
				headers: { 'content-type': 'application/octet-stream' },
				body: new Uint8Array(4096)
			},
			noEnv
		);
		expect(res.status).toBe(403);
		expect(await res.text()).toBe('not available on this network');
	});
});

// Named so this fixture fails ONLY on the route-exists rule. The endpoint
// "POST /api/things/gone" is registered and covered by a test; what it does not
// have is a handler. Someone renamed or deleted the route and updated everything
// except the code.
describe('POST /api/things/gone refuses over clearnet', () => {
	it('returns 403 and touches no binding', async () => {
		const res = await app.request(
			'/api/things/gone',
			{ method: 'POST', headers: { 'content-type': 'application/octet-stream' } },
			noEnv
		);
		expect(res.status).toBe(403);
		expect(await res.text()).toBe('not available on this network');
	});
});
