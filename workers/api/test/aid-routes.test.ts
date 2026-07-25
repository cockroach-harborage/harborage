/**
 * The aid routes: flag posture, and the amplification guard.
 *
 * WHAT IS AND IS NOT TESTABLE HERE. The anti-honeypot machinery (the preimage
 * check, the tick separation, the reservation, the per-responder cap) is NOT
 * tested from this file, and cannot usefully be: with the flag off every route
 * returns a flat 403, with the flag on but no valid one-shot credential a flat
 * 401, and a test asserting "no helper card came back" would pass with all four
 * guards deleted. Those live in workers/api/test/broker.test.ts against the
 * class directly. What IS decidable here is which refusal fires, in what order,
 * and how many Durable Object instances a refused request creates.
 */
import { describe, expect, it } from 'vitest';
import { app } from '../src/app.ts';
import { BROKER_FRAME_LEN, buildBrokerFrame } from '@harborage/worker-lib/broker';

const ROUTES = ['/api/aid/need', '/api/aid/offer', '/api/aid/accept', '/api/aid/poll'] as const;

function frame() {
	return buildBrokerFrame({
		region: 'IN-DL',
		category: 'food',
		sealed: new Uint8Array(3000).fill(2)
	});
}

/**
 * Enable named flags only.
 *
 * A blanket-true stub also enables heightened_threat, and every aid route passes
 * disabledUnderHeightenedThreat: true, so it would 403 for the wrong reason.
 * The archive suite documents the same trap; repeating the shape here rather
 * than sharing it, because a shared helper that drifted would take both suites
 * with it.
 */
function only(...names: string[]) {
	return {
		get: async (k: string) =>
			names.includes(k.replace('flag:', ''))
				? JSON.stringify({ enabled: true, epoch: 1, updatedAt: '2026-07-26' })
				: null
	};
}

/** Always admits, so the rate ladder is never the reason for a refusal. */
const rateLimit = {
	idFromName: (n: string) => n,
	get: () => ({ allow: async () => true, admit: async () => 'ok' })
};

/** Counts how many times a Durable Object namespace is addressed. */
function countingNs() {
	const names: string[] = [];
	return {
		names,
		ns: {
			idFromName(n: string) {
				names.push(n);
				return n;
			},
			get() {
				return {
					openNeed: async () => ({ handleHex: '00'.repeat(16) }),
					claimNeed: async () => null,
					accept: async () => 'ok',
					reveal: async () => null,
					keepalive: async () => undefined,
					deliver: async () => 'ok',
					poll: async () => null
				};
			}
		}
	};
}

function post(path: string, body: BodyInit, env: unknown, headers: Record<string, string> = {}) {
	return app.request(
		path,
		{ method: 'POST', headers: { 'content-type': 'application/octet-stream', ...headers }, body },
		env as never
	);
}

describe('flag posture', () => {
	it('refuses every aid route with exactly 403 while the flag is off', async () => {
		for (const path of ROUTES) {
			const res = await post(path, frame(), { FLAGS: only(), RATE_LIMIT: rateLimit });
			expect(res.status, path).toBe(403);
			expect(await res.text()).toBe('not open');
		}
	});

	/**
	 * A SEPARATE test from the one above, on purpose. If heightened threat were
	 * only covered by the blanket-off case, a route that forgot
	 * disabledUnderHeightenedThreat would still look correct.
	 */
	it('refuses every aid route under heightened threat, flag on', async () => {
		for (const path of ROUTES) {
			const res = await post(path, frame(), {
				FLAGS: only('aid_broker', 'heightened_threat'),
				RATE_LIMIT: rateLimit
			});
			expect(res.status, path).toBe(403);
			expect(await res.text()).toBe('not open');
		}
	});

	it('gets past the flag to the credential check when only aid_broker is on', async () => {
		for (const path of ROUTES) {
			const res = await post(path, frame(), {
				FLAGS: only('aid_broker'),
				RATE_LIMIT: rateLimit
			});
			// 401, not 403: the flag opened and the missing credential is now the
			// reason. Without this the 403s above would be indistinguishable from a
			// route that refuses unconditionally.
			expect(res.status, path).toBe(401);
			expect(await res.text()).toBe('credential required');
		}
	});

	it('refuses with exactly 429 when the rate ladder says no', async () => {
		const deny = { idFromName: (n: string) => n, get: () => ({ allow: async () => false }) };
		const res = await post('/api/aid/need', frame(), {
			FLAGS: only('aid_broker'),
			RATE_LIMIT: deny
		});
		expect(res.status).toBe(429);
	});
});

describe('a refused request creates no Durable Object', () => {
	/**
	 * THE AMPLIFICATION GUARD, asserted as a COUNT rather than a status.
	 *
	 * A status assertion alone cannot distinguish "refused before addressing an
	 * instance" from "refused after minting one", and minting one per request is
	 * the whole attack. Counting is the only way to see it.
	 */
	it('addresses no broker or mailbox instance while the flag is off', async () => {
		for (const path of ROUTES) {
			const b = countingNs();
			const m = countingNs();
			const res = await post(path, frame(), {
				FLAGS: only(),
				RATE_LIMIT: rateLimit,
				BROKER: b.ns,
				MAILBOX: m.ns,
				BROKER_INBOX_MAC_KEY: 'a-test-mac-key'
			});
			expect(res.status, path).toBe(403);
			expect(b.names, `broker instances for ${path}`).toHaveLength(0);
			expect(m.names, `mailbox instances for ${path}`).toHaveLength(0);
		}
	});

	it('addresses no instance for a body that fails the structural check', async () => {
		const b = countingNs();
		const m = countingNs();
		const res = await post('/api/aid/poll', new Uint8Array(BROKER_FRAME_LEN - 1), {
			FLAGS: only('aid_broker'),
			RATE_LIMIT: rateLimit,
			BROKER: b.ns,
			MAILBOX: m.ns,
			BROKER_INBOX_MAC_KEY: 'a-test-mac-key'
		});
		expect(res.status).toBe(400);
		expect(b.names).toHaveLength(0);
		expect(m.names).toHaveLength(0);
	});
});

describe('the resting state', () => {
	/**
	 * BROKER_INBOX_MAC_KEY is absent in production. While it is, every brokered
	 * route refuses for everyone even with the flag on, which is the correct
	 * posture until a broker is actually operated. This asserts BOTH the refusal
	 * and that nothing was instantiated on the way to it.
	 */
	it('refuses with the MAC key absent, and mints nothing', async () => {
		for (const path of ROUTES) {
			const b = countingNs();
			const m = countingNs();
			const res = await post(path, frame(), {
				FLAGS: only('aid_broker'),
				RATE_LIMIT: rateLimit,
				BROKER: b.ns,
				MAILBOX: m.ns,
				TURNSTILE_SECRET: undefined
			});
			// The credential check fires first with no credential attached, which is
			// itself the point: nothing downstream of it ran.
			expect(res.status, path).toBe(401);
			expect(b.names).toHaveLength(0);
			expect(m.names).toHaveLength(0);
		}
	});
});
