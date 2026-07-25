import { describe, expect, it } from 'vitest';
import { app } from '../src/app.ts';
import {
	ALG_SEALED_BOX_X25519,
	ALG_VAULT_KEYRING,
	frameEnvelope
} from '@harborage/worker-lib/envelope';
import { BROKER_FRAME_LEN, buildBrokerFrame } from '@harborage/worker-lib/broker';

/**
 * gate-sealed-body: "POST /api/aid/need", "POST /api/aid/accept" and
 * "POST /api/aid/poll" must each have a test proving the intake Worker
 * structurally rejects a body that is not a sealed envelope of the right shape.
 *
 * EVERY REJECTION BELOW HAPPENS BEFORE ANY BINDING IS TOUCHED, which is why the
 * env is empty. That is not a convenience: passing no bindings is the proof.
 * Move the length or framing check below the credential and these tests throw
 * or 500 instead of returning the exact status, rather than quietly passing
 * because a 401 fired first. That is the /api/archive/dedup lesson, applied
 * before the mistake rather than after it.
 */
const noEnv = {} as never;

const ROUTES = ['/api/aid/need', '/api/aid/offer', '/api/aid/accept', '/api/aid/poll'] as const;

function post(path: string, contentType: string, body: BodyInit) {
	return app.request(
		path,
		{ method: 'POST', headers: { 'content-type': contentType }, body },
		noEnv
	);
}

describe.each(ROUTES)('%s rejects non-sealed bodies', (path) => {
	it('rejects a plain JSON body with exactly 415', async () => {
		const res = await post(path, 'application/json', JSON.stringify({ need: 'water' }));
		expect(res.status).toBe(415);
		expect(await res.text()).toBe('sealed envelope required');
	});

	/**
	 * EXACT length, not a ceiling. A short frame is not merely malformed: a lane
	 * that accepted one would let a sender pick a length, which is the size
	 * channel the fixed framing exists to close.
	 */
	it('rejects a frame one byte short with exactly 400', async () => {
		const res = await post(path, 'application/octet-stream', new Uint8Array(BROKER_FRAME_LEN - 1));
		expect(res.status).toBe(400);
		expect(await res.text()).toBe('sealed envelope required');
	});

	it('rejects a frame one byte long with exactly 400', async () => {
		const res = await post(path, 'application/octet-stream', new Uint8Array(BROKER_FRAME_LEN + 1));
		expect(res.status).toBe(400);
	});

	it('rejects a right-sized body with no envelope header with exactly 400', async () => {
		const res = await post(path, 'application/octet-stream', new Uint8Array(BROKER_FRAME_LEN));
		expect(res.status).toBe(400);
	});

	/**
	 * The lane check. A body framed for another custody class must not be filed
	 * here and inherit this endpoint's claim, even at the right length.
	 */
	it('rejects a right-sized body framed for a different lane with exactly 400', async () => {
		for (const alg of [ALG_SEALED_BOX_X25519, ALG_VAULT_KEYRING]) {
			const wrong = frameEnvelope(new Uint8Array(BROKER_FRAME_LEN - 5), alg);
			expect(wrong.length).toBe(BROKER_FRAME_LEN);
			const res = await post(path, 'application/octet-stream', wrong);
			expect(res.status, `alg ${alg}`).toBe(400);
		}
	});

	it('rejects a broker-framed body whose routing prefix does not parse, with exactly 400', async () => {
		const frame = buildBrokerFrame({
			region: 'IN-DL',
			category: 'food',
			sealed: new Uint8Array(3000).fill(2)
		});
		// Corrupt the category ordinal. Length and header are still correct, so
		// only the prefix parse can reject it.
		frame[5 + 1 + 12] = 200;
		const res = await post(path, 'application/octet-stream', frame);
		expect(res.status).toBe(400);
	});

	/**
	 * The positive control. Without it, every assertion above is satisfiable by a
	 * handler that returns 400 unconditionally, and the structural checks would
	 * look enforced while testing nothing. A well-formed frame must get PAST the
	 * structural stage, which with an empty env means it fails later and
	 * differently.
	 */
	it('lets a well-formed frame past the structural stage', async () => {
		const frame = buildBrokerFrame({
			region: 'IN-DL',
			category: 'food',
			sealed: new Uint8Array(3000).fill(2)
		});
		const res = await post(path, 'application/octet-stream', frame);
		expect(res.status).not.toBe(415);
		expect(res.status).not.toBe(400);
	});
});
