import { describe, expect, it } from 'vitest';
import { app } from '../src/app.ts';

// FAIL fixture: a test that names the endpoint but proves nothing.
//
// One assertion, and it is `not.toBe(200)`. That passes when the flag is off,
// when the credential is missing, and when the origin guard has been deleted
// entirely, so it cannot tell "refused for the right reason" from "refused for
// any reason". It also never mentions the status the guard actually returns.
//
// This is the shape that has bitten this repo three times, kept as a fixture so
// the requirement for two assertions and a literal 403 stays load-bearing.
describe('POST /api/things/triage', () => {
	it('does not succeed without an assertion', async () => {
		const res = await app.request('/api/things/triage', { method: 'POST' }, {} as never);
		expect(res.status).not.toBe(200);
	});
});
