/**
 * Mailbox DO: fixed-duration polls and lazy expiry.
 *
 * The duration property is the security-relevant half. Fixed LENGTH is tested
 * in worker-lib/test/broker.test.ts; length alone is not enough, because a poll
 * that returns as soon as a message arrives makes round-trip TIME a perfect
 * presence oracle that no padding repairs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Mailbox } from '../src/do/Mailbox.ts';
import { BROKER_FRAME_LEN, POLL_WAIT_TICKS, TICK_MS } from '@harborage/worker-lib/broker';

const T0 = new Date('2026-07-26T00:00:00Z').getTime();
const POLL_MS = TICK_MS * POLL_WAIT_TICKS;

function newMailbox(): Mailbox {
	return new (Mailbox as unknown as new () => Mailbox)();
}

function frame(fill = 1): Uint8Array {
	return new Uint8Array(BROKER_FRAME_LEN).fill(fill);
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date(T0));
});

afterEach(() => {
	vi.useRealTimers();
});

describe('fixed-duration poll', () => {
	/**
	 * THE TIMING CLAIM. An empty poll and a delivering poll must settle at the
	 * same instant. Add an early return on delivery and the delivering half
	 * settles first, so this goes red.
	 */
	it('settles an empty poll and a delivering poll at the same moment', async () => {
		const empty = newMailbox();
		const full = newMailbox();
		await full.deliver(frame(), T0);

		let emptyDone = false;
		let fullDone = false;
		const a = empty.poll(T0).then(() => {
			emptyDone = true;
		});
		const b = full.poll(T0).then(() => {
			fullDone = true;
		});

		await vi.advanceTimersByTimeAsync(POLL_MS - 1);
		expect(emptyDone).toBe(false);
		expect(fullDone).toBe(false);

		await vi.advanceTimersByTimeAsync(1);
		await Promise.all([a, b]);
		expect(emptyDone).toBe(true);
		expect(fullDone).toBe(true);
	});

	it('returns the frame it was given, and null when there is none', async () => {
		const mb = newMailbox();
		await mb.deliver(frame(7), T0);
		const p = mb.poll(T0);
		await vi.advanceTimersByTimeAsync(POLL_MS);
		const got = await p;
		expect(got).not.toBeNull();
		expect(got!.length).toBe(BROKER_FRAME_LEN);
		expect(got![0]).toBe(7);

		const p2 = mb.poll(T0);
		await vi.advanceTimersByTimeAsync(POLL_MS);
		expect(await p2).toBeNull();
	});

	/** A message delivered mid-poll is picked up without shortening the wait. */
	it('picks up a frame that arrives while the poll is open', async () => {
		const mb = newMailbox();
		const p = mb.poll(T0);
		await vi.advanceTimersByTimeAsync(TICK_MS);
		await mb.deliver(frame(3), T0 + TICK_MS);
		await vi.advanceTimersByTimeAsync(POLL_MS);
		const got = await p;
		expect(got).not.toBeNull();
		expect(got![0]).toBe(3);
	});
});

describe('frame discipline', () => {
	/**
	 * A short frame is refused rather than padded on receipt. Accepting one and
	 * padding it later would let a sender choose a length the mailbox then has to
	 * normalise, which is a channel by another name.
	 */
	it('refuses anything that is not exactly one frame long', async () => {
		const mb = newMailbox();
		expect(await mb.deliver(new Uint8Array(BROKER_FRAME_LEN - 1), T0)).toBe('bad-frame');
		expect(await mb.deliver(new Uint8Array(BROKER_FRAME_LEN + 1), T0)).toBe('bad-frame');
		expect(await mb.depth(T0)).toBe(0);
		expect(await mb.deliver(frame(), T0)).toBe('ok');
	});

	it('refuses past the queue ceiling rather than growing without bound', async () => {
		const mb = newMailbox();
		let ok = 0;
		for (let i = 0; i < 20; i++) if ((await mb.deliver(frame(), T0)) === 'ok') ok++;
		expect(ok).toBe(8);
		expect(await mb.deliver(frame(), T0)).toBe('full');
	});
});

describe('lazy expiry, with no alarm', () => {
	/**
	 * Nothing is armed. Expiry happens because a later call looks at the clock,
	 * which is what lets this class be wholly memory-only: an alarm would be a
	 * durable, PITR-visible row saying something is pending at time T.
	 */
	it('drops the queue once the mailbox has aged out', async () => {
		const mb = newMailbox();
		await mb.deliver(frame(), T0);
		expect(await mb.depth(T0)).toBe(1);
		expect(await mb.depth(T0 + 15 * 60_000 - 1)).toBe(1);
		expect(await mb.depth(T0 + 15 * 60_000)).toBe(0);
	});

	it('starts a fresh window on the next delivery', async () => {
		const mb = newMailbox();
		await mb.deliver(frame(), T0);
		expect(await mb.depth(T0 + 15 * 60_000)).toBe(0);
		await mb.deliver(frame(), T0 + 15 * 60_000);
		expect(await mb.depth(T0 + 15 * 60_000 + 1)).toBe(1);
	});
});

describe('concurrent polls', () => {
	it('refuses a third concurrent poll rather than parking it', async () => {
		const mb = newMailbox();
		const a = mb.poll(T0);
		const b = mb.poll(T0);
		const c = mb.poll(T0);
		// The third returns immediately, without occupying the instance.
		expect(await c).toBeNull();
		await vi.advanceTimersByTimeAsync(POLL_MS);
		await Promise.all([a, b]);
	});
});
