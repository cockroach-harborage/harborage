import { describe, expect, it } from 'vitest';
import { app } from '../src/app.ts';

// gate-sealed-body: the registered endpoint "POST /api/incidents/register" must
// have a test proving the intake Worker structurally rejects any body that is
// not a sealed envelope. Both rejections happen before any binding is touched,
// so a minimal env is enough.
const noEnv = {} as never;

describe('POST /api/incidents/register rejects non-sealed bodies', () => {
	it('rejects a plain JSON body with 415', async () => {
		const res = await app.request(
			'/api/incidents/register',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ incident: 'baton charge', where: 'somewhere' })
			},
			noEnv
		);
		expect(res.status).toBe(415);
	});

	it('rejects octet-stream that is not a framed sealed envelope with 400', async () => {
		const res = await app.request(
			'/api/incidents/register',
			{
				method: 'POST',
				headers: { 'content-type': 'application/octet-stream' },
				body: new Uint8Array(64) // valid length, but no HBE1 magic
			},
			noEnv
		);
		expect(res.status).toBe(400);
	});
});
