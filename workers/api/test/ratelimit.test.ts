/**
 * RateLimit DO: token bucket + PoP anti-replay.
 *
 * The replay memory is the security-relevant half. A missed replay lets a
 * captured proof be reused inside its freshness window, which is exactly what
 * the nonce exists to stop.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RateLimit } from '../src/do/RateLimit.ts';

const RETAIN = 120_000;

function newLimiter(): RateLimit {
	return new (RateLimit as unknown as new () => RateLimit)();
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-07-25T00:00:00Z'));
});

afterEach(() => {
	vi.useRealTimers();
});

describe('token bucket', () => {
	it('allows a burst then refuses, and refills over time', async () => {
		const rl = newLimiter();
		let allowed = 0;
		for (let i = 0; i < 40; i++) if (await rl.allow()) allowed++;
		// Capacity is the burst allowance; everything past it is refused.
		expect(allowed).toBe(30);
		expect(await rl.allow()).toBe(false);

		// Refill is 0.5/sec, so ten seconds buys five more.
		vi.advanceTimersByTime(10_000);
		let after = 0;
		for (let i = 0; i < 10; i++) if (await rl.allow()) after++;
		expect(after).toBe(5);
	});

	it('never refills past capacity', async () => {
		const rl = newLimiter();
		await rl.allow();
		vi.advanceTimersByTime(60 * 60_000);
		let allowed = 0;
		for (let i = 0; i < 100; i++) if (await rl.allow()) allowed++;
		expect(allowed).toBe(30);
	});
});

describe('anti-replay', () => {
	it('admits a nonce once and calls the second use a replay', async () => {
		const rl = newLimiter();
		expect(await rl.admit('aa', RETAIN)).toBe('ok');
		expect(await rl.admit('aa', RETAIN)).toBe('replay');
		expect(await rl.admit('bb', RETAIN)).toBe('ok');
	});

	it('forgets a nonce only after its retention has passed', async () => {
		const rl = newLimiter();
		expect(await rl.admit('aa', RETAIN)).toBe('ok');
		vi.advanceTimersByTime(RETAIN - 1000);
		expect(await rl.admit('aa', RETAIN)).toBe('replay');

		// Past retention the proof can no longer be fresh, so remembering it
		// buys nothing and costs memory.
		vi.advanceTimersByTime(2000);
		expect(await rl.admit('aa', RETAIN)).toBe('ok');
	});

	// A rate-limited attempt must not burn the nonce: the client will retry,
	// and rejecting that retry as a replay would strand a legitimate sender.
	it('does not consume a nonce when the bucket refuses', async () => {
		const rl = newLimiter();
		for (let i = 0; i < 30; i++) await rl.allow();
		expect(await rl.admit('fresh', RETAIN)).toBe('rate-limited');

		vi.advanceTimersByTime(10_000);
		expect(await rl.admit('fresh', RETAIN)).toBe('ok');
	});

	// Replaying still costs the attacker budget rather than being a free probe.
	it('charges the bucket for a replay', async () => {
		const rl = newLimiter();
		expect(await rl.admit('aa', RETAIN)).toBe('ok');
		for (let i = 0; i < 29; i++) expect(await rl.admit(`n${i}`, RETAIN)).toBe('ok');
		// Budget is now spent, so even a genuine replay attempt is rate-limited
		// rather than reaching the nonce check.
		expect(await rl.admit('aa', RETAIN)).toBe('rate-limited');
	});

	it('keeps memory bounded under a flood of distinct nonces', async () => {
		const rl = newLimiter();
		// Refill enough budget to push far more nonces than the cap allows.
		for (let i = 0; i < 25_000; i++) {
			vi.advanceTimersByTime(2000);
			expect(await rl.admit(`n${i}`, 60 * 60_000)).toBe('ok');
		}
		const seen = (rl as unknown as { seen: Map<string, number> }).seen;
		expect(seen.size).toBeLessThanOrEqual(20_000);
		// The most recent nonce is always still remembered, so the eviction
		// policy cannot silently stop protecting the live window.
		expect(await rl.admit('n24999', 60 * 60_000)).toBe('replay');
	});

	it('treats a zero or negative retention as immediate expiry, never as forever', async () => {
		const rl = newLimiter();
		expect(await rl.admit('aa', 0)).toBe('ok');
		vi.advanceTimersByTime(1);
		expect(await rl.admit('aa', 0)).toBe('ok');
		expect(await rl.admit('bb', -5000)).toBe('ok');
	});
});
