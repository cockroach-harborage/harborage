import { describe, expect, it } from 'vitest';
import { app } from '../src/app.ts';
import {
	ALG_SEALED_BOX_X25519,
	ALG_VAULT_KEYRING,
	frameEnvelope
} from '@harborage/worker-lib/envelope';

// gate-sealed-body: the registered endpoint "POST /api/evidence/keyring" must
// have a test proving the intake Worker structurally rejects any body that is
// not a sealed envelope of the RIGHT sealed object. Every rejection below
// happens before any binding is touched, so a minimal env is enough.
const noEnv = {} as never;

function post(contentType: string, body: BodyInit) {
	return app.request(
		'/api/evidence/keyring',
		{ method: 'POST', headers: { 'content-type': contentType }, body },
		noEnv
	);
}

describe('POST /api/evidence/keyring rejects non-sealed bodies', () => {
	it('rejects a plain JSON body with 415', async () => {
		const res = await post('application/json', JSON.stringify({ cek: 'here you go' }));
		expect(res.status).toBe(415);
	});

	it('rejects octet-stream that is not a framed sealed envelope with 400', async () => {
		const res = await post('application/octet-stream', new Uint8Array(256));
		expect(res.status).toBe(400);
	});

	/**
	 * The lane check. A body framed for the incident-metadata algorithm is a
	 * SEALED-TO-PLATFORM object that a platform key opens by design. Filing it
	 * here would let it inherit this endpoint's SEALED-E2E claim, so the endpoint
	 * refuses anything that is not framed as a vault keyring.
	 */
	it('rejects a validly sealed body from a different custody lane with 400', async () => {
		const res = await post(
			'application/octet-stream',
			frameEnvelope(new Uint8Array(256), ALG_SEALED_BOX_X25519)
		);
		expect(res.status).toBe(400);
	});

	it('rejects a keyring-framed body that is too short to hold one sealed copy', async () => {
		const res = await post('application/octet-stream', frameEnvelope(new Uint8Array(80), ALG_VAULT_KEYRING));
		expect(res.status).toBe(400);
	});
});
