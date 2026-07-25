/**
 * Broker DO: reservation, acceptance cap, and the two-request exposure rule.
 *
 * EVERY CLAIM HERE IS INVISIBLE FROM A ROUTE TEST. With the flag off each
 * /api/aid/* route returns a flat 403; with the flag on but no valid one-shot
 * credential, a flat 401; with a bad token, a flat 403. A test that posts to
 * /api/aid/poll and asserts "no helper card came back" passes with the preimage
 * check, the tick check, the reservation AND the cap all four deleted. So they
 * are tested against the class, constructed in process, the way
 * ratelimit.test.ts constructs RateLimit.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Broker } from '../src/do/Broker.ts';
import { BROKER_FRAME_LEN, TICK_MS } from '@harborage/worker-lib/broker';

const T0 = new Date('2026-07-26T00:00:00Z').getTime();
const NEED_TTL = 15 * 60_000;
const RESERVATION = 3 * 60_000;
/** Comfortably more than one tick, so "a later tick" is unambiguous. */
const LATER = TICK_MS * 2;

function newBroker(): Broker {
	return new (Broker as unknown as new () => Broker)();
}

function frame(fill = 1): Uint8Array {
	return new Uint8Array(BROKER_FRAME_LEN).fill(fill);
}

async function sha256(b: Uint8Array): Promise<Uint8Array> {
	return new Uint8Array(await crypto.subtle.digest('SHA-256', b as BufferSource));
}

function handle(fill: number): Uint8Array {
	return new Uint8Array(16).fill(fill);
}

/** Open one need and return its handle plus the secret behind its commitment. */
async function openOne(b: Broker, at = T0, fill = 1) {
	const secret = new Uint8Array(32).fill(fill + 100);
	const opened = await b.openNeed(
		{
			category: 'food',
			commit: await sha256(secret),
			seekerInbox: `seeker-${fill}`,
			handle: handle(fill)
		},
		at
	);
	if (opened === 'full' || opened === 'bad-input') throw new Error(`openNeed returned ${opened}`);
	return { handleHex: opened.handleHex, secret };
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date(T0));
});

afterEach(() => {
	vi.useRealTimers();
});

describe('one responder at a time', () => {
	/**
	 * A need visible to many responders at once is a need many strangers are
	 * converging on, and the seeker has no way to tell which of them is real.
	 * Delete the reservation and the second helper gets the same need.
	 */
	it('hands a waiting need to one helper and not the next', async () => {
		const b = newBroker();
		await openOne(b);
		const first = await b.claimNeed('helper-a', 'food', T0);
		expect(first).not.toBeNull();
		expect(await b.claimNeed('helper-b', 'food', T0)).toBeNull();
	});

	it('returns a need to the queue when a reservation lapses', async () => {
		const b = newBroker();
		await openOne(b);
		expect(await b.claimNeed('helper-a', 'food', T0)).not.toBeNull();
		expect(await b.claimNeed('helper-b', 'food', T0 + RESERVATION - 1)).toBeNull();
		expect(await b.claimNeed('helper-b', 'food', T0 + RESERVATION + 1)).not.toBeNull();
	});

	it('does not hand out a need of a different category', async () => {
		const b = newBroker();
		await openOne(b);
		expect(await b.claimNeed('helper-a', 'water', T0)).toBeNull();
		expect(await b.claimNeed('helper-a', 'food', T0)).not.toBeNull();
	});
});

describe('exposure requires two separately-ticked requests', () => {
	/**
	 * THE TICK COMPARISON. This is the guard most likely to be simplified away,
	 * so the test is named for it. Without it, a client accepts and reveals in one
	 * burst, collapsing two requests into one round trip and removing every
	 * property the mechanism provides.
	 */
	it('withholds the card when accept and reveal land in the same tick', async () => {
		const b = newBroker();
		const { handleHex, secret } = await openOne(b);
		await b.claimNeed('helper-a', 'food', T0);
		expect(await b.accept(handleHex, 'helper-a', frame(9), T0)).toBe('ok');

		expect(await b.reveal(handleHex, secret, T0)).toBeNull();

		const got = await b.reveal(handleHex, secret, T0 + LATER);
		expect(got).not.toBeNull();
		expect(got![0]).toBe(9);
	});

	/**
	 * The commitment binds the reveal to THIS need. Note what this does and does
	 * not prove: whoever planted a fake need also chose the secret, so this is
	 * proof of continued presence, never proof the need is real.
	 */
	it('withholds the card for a wrong preimage, and keeps holding it', async () => {
		const b = newBroker();
		const { handleHex, secret } = await openOne(b);
		await b.claimNeed('helper-a', 'food', T0);
		await b.accept(handleHex, 'helper-a', frame(9), T0);

		expect(await b.reveal(handleHex, new Uint8Array(32).fill(0xaa), T0 + LATER)).toBeNull();
		// Still held: a wrong guess must not consume the card.
		expect(await b.reveal(handleHex, secret, T0 + LATER)).not.toBeNull();
	});

	it('releases the card once only', async () => {
		const b = newBroker();
		const { handleHex, secret } = await openOne(b);
		await b.claimNeed('helper-a', 'food', T0);
		await b.accept(handleHex, 'helper-a', frame(9), T0);
		expect(await b.reveal(handleHex, secret, T0 + LATER)).not.toBeNull();
		expect(await b.reveal(handleHex, secret, T0 + LATER * 2)).toBeNull();
	});

	it('reveals nothing for a need that was never accepted', async () => {
		const b = newBroker();
		const { handleHex, secret } = await openOne(b);
		expect(await b.reveal(handleHex, secret, T0 + LATER)).toBeNull();
	});
});

describe('acceptance discipline', () => {
	it('refuses an acceptance from a helper who does not hold the reservation', async () => {
		const b = newBroker();
		const { handleHex } = await openOne(b);
		await b.claimNeed('helper-a', 'food', T0);
		expect(await b.accept(handleHex, 'helper-b', frame(), T0)).toBe('taken');
	});

	it('refuses a second acceptance on the same need', async () => {
		const b = newBroker();
		const { handleHex } = await openOne(b);
		await b.claimNeed('helper-a', 'food', T0);
		expect(await b.accept(handleHex, 'helper-a', frame(), T0)).toBe('ok');
		expect(await b.accept(handleHex, 'helper-a', frame(), T0)).toBe('taken');
	});

	it('refuses an unknown need', async () => {
		const b = newBroker();
		expect(await b.accept('deadbeef', 'helper-a', frame(), T0)).toBe('unknown');
	});

	it('refuses a frame that is not exactly one frame long', async () => {
		const b = newBroker();
		const { handleHex } = await openOne(b);
		await b.claimNeed('helper-a', 'food', T0);
		expect(await b.accept(handleHex, 'helper-a', new Uint8Array(10), T0)).toBe('bad-frame');
	});

	/**
	 * HONEST LIMIT, and the test says so: the cap keys on an inbox handle, and a
	 * responder can mint a fresh one-shot identity and a fresh inbox per
	 * acceptance. This is friction against a lazy scraper, not a bound on a
	 * determined one.
	 */
	it('caps acceptances per responder inbox', async () => {
		const b = newBroker();
		const outcomes: string[] = [];
		for (let i = 1; i <= 4; i++) {
			const { handleHex } = await openOne(b, T0, i);
			await b.claimNeed('helper-a', 'food', T0);
			outcomes.push(await b.accept(handleHex, 'helper-a', frame(), T0));
		}
		expect(outcomes).toEqual(['ok', 'ok', 'ok', 'capped']);

		// A different inbox is unaffected, which is what makes it a per-responder
		// cap rather than a global one.
		const { handleHex } = await openOne(b, T0, 9);
		await b.claimNeed('helper-b', 'food', T0);
		expect(await b.accept(handleHex, 'helper-b', frame(), T0)).toBe('ok');
	});
});

describe('lazy expiry, with no alarm', () => {
	it('drops a need once it has aged out', async () => {
		const b = newBroker();
		await openOne(b);
		expect(await b.openCount(T0)).toBe(1);
		expect(await b.openCount(T0 + NEED_TTL - 1)).toBe(1);
		expect(await b.openCount(T0 + NEED_TTL)).toBe(0);
	});

	it('will not hand out an expired need', async () => {
		const b = newBroker();
		await openOne(b);
		expect(await b.claimNeed('helper-a', 'food', T0 + NEED_TTL)).toBeNull();
	});

	it('refuses past the open-need ceiling rather than growing without bound', async () => {
		const b = newBroker();
		for (let i = 0; i < 500; i++) {
			const opened = await b.openNeed(
				{
					category: 'food',
					commit: new Uint8Array(32).fill(i & 0xff),
					seekerInbox: `s${i}`,
					// Distinct handles, so this counts needs rather than overwriting one.
					handle: new Uint8Array(16).fill(0).map((_, k) => (k === 0 ? i & 0xff : i >> 8))
				},
				T0
			);
			expect(opened).not.toBe('full');
		}
		expect(await b.openCount(T0)).toBe(500);
		const overflow = await b.openNeed(
			{
				category: 'food',
				commit: new Uint8Array(32),
				seekerInbox: 'one-too-many',
				handle: new Uint8Array(16).fill(0xff)
			},
			T0
		);
		expect(overflow).toBe('full');
	});
});

describe('input discipline', () => {
	it('refuses a commitment or handle of the wrong length', async () => {
		const b = newBroker();
		expect(
			await b.openNeed(
				{ category: 'food', commit: new Uint8Array(8), seekerInbox: 's', handle: handle(1) },
				T0
			)
		).toBe('bad-input');
		expect(
			await b.openNeed(
				{
					category: 'food',
					commit: new Uint8Array(32),
					seekerInbox: 's',
					handle: new Uint8Array(4)
				},
				T0
			)
		).toBe('bad-input');
	});
});
