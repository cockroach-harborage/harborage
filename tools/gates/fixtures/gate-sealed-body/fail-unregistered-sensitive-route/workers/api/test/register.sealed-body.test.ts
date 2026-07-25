// Covers POST /api/things/register and POST /api/things/keyring.
import { describe, expect, it } from 'vitest';

describe('register', () => {
	it('rejects a non-sealed body', async () => {
		expect(await post('text/plain')).toBe(415);
		expect(await post('application/octet-stream')).toBe(400);
	});
});
