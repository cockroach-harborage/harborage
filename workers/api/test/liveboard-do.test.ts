/**
 * LiveBoard DO: the oracle, the salt rotation, and the rebuilding window.
 *
 * The pure predicates are tested in packages/worker-lib. What is only decidable
 * here is what the CLASS reveals: what report() returns, what survives a salt
 * rotation, and what a freshly-constructed instance says about itself.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveBoard } from '../src/do/LiveBoard.ts';
import {
	DENSITY_FLOOR_D,
	DEDUP_EPOCH_MS,
	PUBLICATION_DELAY_BASE_MS,
	PUBLICATION_JITTER_MAX_MS,
	REBUILD_TICKS,
	SIGNAL_TTL_MS,
	TICK_MS
} from '@harborage/worker-lib/liveboard';

const T0 = new Date('2026-07-26T00:00:00Z').getTime();
const ZONE = 'IN-DL-z0417';
/** Comfortably past base + max jitter, so the delay is never the reason. */
const PUBLISHED = PUBLICATION_DELAY_BASE_MS + PUBLICATION_JITTER_MAX_MS + 1000;

function newBoard(): LiveBoard {
	return new (LiveBoard as unknown as new () => LiveBoard)();
}

/** A distinct dedup token per reporter. */
function tok(i: number): Uint8Array {
	const t = new Uint8Array(32);
	let x = (i * 2654435761 + 999) >>> 0;
	for (let b = 0; b < 32; b++) {
		x = (x * 1103515245 + 12345) >>> 0;
		t[b] = (x >>> 16) & 0xff;
	}
	return t;
}

async function reportN(
	board: LiveBoard,
	n: number,
	at: number,
	signal = 'TEAR_GAS' as const,
	from = 0
) {
	for (let i = 0; i < n; i++) {
		await board.report({ zoneId: ZONE, signal, dedupToken: tok(i + from), nowMs: at });
	}
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date(T0));
});

afterEach(() => {
	vi.useRealTimers();
});

describe('report() is not an oracle', () => {
	/**
	 * THE SINGLE EASIEST WAY TO DESTROY SUPPRESS-UNTIL-SAFE-DENSITY. If the return
	 * value revealed whether the signal crossed the floor, whether the token was a
	 * duplicate, or how many reporters there are, an attacker reporting once a
	 * second from N credentials would binary-search the true count straight out of
	 * it.
	 *
	 * Asserted as IDENTITY of the returned value across wildly different internal
	 * states, not as a property of an object, because an object could gain a field.
	 */
	it('returns the identical value at 1, 4, 5 and 50 reporters', async () => {
		const board = newBoard();
		const seen = new Set<unknown>();
		for (const n of [1, 4, 5, 50]) {
			const b = newBoard();
			await reportN(b, n, T0);
			seen.add(
				await b.report({ zoneId: ZONE, signal: 'TEAR_GAS', dedupToken: tok(999), nowMs: T0 })
			);
		}
		expect(seen.size).toBe(1);
		expect([...seen][0]).toBe('accepted');
		// And a duplicate token is indistinguishable from a fresh one.
		await board.report({ zoneId: ZONE, signal: 'TEAR_GAS', dedupToken: tok(1), nowMs: T0 });
		expect(
			await board.report({ zoneId: ZONE, signal: 'TEAR_GAS', dedupToken: tok(1), nowMs: T0 })
		).toBe('accepted');
	});

	it('returns a primitive, so there is no object to grow a field on', async () => {
		const board = newBoard();
		const r = await board.report({
			zoneId: ZONE,
			signal: 'TEAR_GAS',
			dedupToken: tok(0),
			nowMs: T0
		});
		expect(typeof r).toBe('string');
	});
});

describe('the density floor, through the class', () => {
	it('shows nothing below the floor however long has passed', async () => {
		const board = newBoard();
		await reportN(board, DENSITY_FLOOR_D - 1, T0);
		const view = await board.view({ nowMs: T0 + PUBLISHED });
		expect(view.signals).toHaveLength(0);
	});

	it('shows the signal at the floor', async () => {
		const board = newBoard();
		await reportN(board, DENSITY_FLOOR_D, T0);
		const view = await board.view({ nowMs: T0 + PUBLISHED });
		expect(view.signals.map((s) => s.signal)).toEqual(['TEAR_GAS']);
	});

	it('counts a repeated reporter once, so one person cannot cross the floor alone', async () => {
		const board = newBoard();
		for (let i = 0; i < 50; i++) {
			await board.report({ zoneId: ZONE, signal: 'TEAR_GAS', dedupToken: tok(7), nowMs: T0 });
		}
		expect(await board.densityForTest(T0)).toBe(1);
		expect((await board.view({ nowMs: T0 + PUBLISHED })).signals).toHaveLength(0);
	});
});

describe('salt rotation resets the sketch', () => {
	/**
	 * Keeping the sketch across a rotation would double-count a reporter whose new
	 * token lands in a different register, and inflation is the direction that
	 * pushes a small group over the floor.
	 *
	 * THE SAME reporters must re-report after rotation, not different ones: with
	 * different tokens the total would be 8 either way and the test would prove
	 * nothing.
	 */
	it('does not double-count the same reporters across a rotation', async () => {
		const board = newBoard();
		await reportN(board, 4, T0);
		expect(await board.densityForTest(T0)).toBe(4);

		const after = T0 + DEDUP_EPOCH_MS + 1;
		await reportN(board, 4, after); // the SAME four
		expect(await board.densityForTest(after)).toBe(4);
	});

	/**
	 * The overlap window, which is why rotation does not make a publishing zone go
	 * dark and strobe back at every fifteen-minute boundary. max(), never sum.
	 */
	it('keeps the previous epoch alive briefly, without summing it', async () => {
		const board = newBoard();
		await reportN(board, DENSITY_FLOOR_D, T0);
		const after = T0 + DEDUP_EPOCH_MS + 1;
		// Nothing reported in the new epoch yet, but the floor still holds.
		expect(await board.densityForTest(after)).toBe(DENSITY_FLOOR_D);
		// And it is a max, not a sum: reporting the same people again keeps it flat.
		await reportN(board, DENSITY_FLOOR_D, after);
		expect(await board.densityForTest(after)).toBe(DENSITY_FLOOR_D);
	});

	/**
	 * The overlap is measured from the EPOCH BOUNDARY, not from when rotation was
	 * observed. Keyed to observation, a board nobody touched for an hour would give
	 * the previous epoch a fresh lease on its next call, so hour-old reporters
	 * would keep inflating the density floor. This test is what caught that.
	 */
	it('drops the previous epoch 90 seconds past the boundary, whenever it is next read', async () => {
		const board = newBoard();
		await reportN(board, DENSITY_FLOOR_D, T0);
		const boundary = (Math.floor(T0 / DEDUP_EPOCH_MS) + 1) * DEDUP_EPOCH_MS;
		// Just inside the overlap: still counted.
		expect(await board.densityForTest(boundary + 1000)).toBe(DENSITY_FLOOR_D);
		// Past it: gone.
		expect(await board.densityForTest(boundary + 120_000)).toBe(0);
	});

	it('drops it on the first touch after a long quiet gap, not 90 seconds later', async () => {
		const board = newBoard();
		await reportN(board, DENSITY_FLOOR_D, T0);
		// Nobody touches the board for an hour. The first read must not hand the
		// stale sketch a fresh lease.
		expect(await board.densityForTest(T0 + 3_600_000)).toBe(0);
	});
});

describe('the rebuilding window', () => {
	/**
	 * After eviction the board comes back EMPTY, and empty is indistinguishable
	 * from "no hazards here". This flag is what lets the client keep its cached
	 * rows with a STALE badge instead of flashing to nothing, which is the concrete
	 * form §6.5's "never dark" takes.
	 */
	it('reports rebuilding on a fresh instance, then stops', async () => {
		const board = newBoard();
		expect((await board.view({ nowMs: T0 })).rebuilding).toBe(true);
		expect((await board.view({ nowMs: T0 + REBUILD_TICKS * TICK_MS - 1 })).rebuilding).toBe(true);
		expect((await board.view({ nowMs: T0 + REBUILD_TICKS * TICK_MS })).rebuilding).toBe(false);
	});

	/** A second instance is what eviction looks like: same zone, no state. */
	it('a replacement instance starts with no signals and says it is rebuilding', async () => {
		const first = newBoard();
		await reportN(first, DENSITY_FLOOR_D, T0);
		expect((await first.view({ nowMs: T0 + PUBLISHED })).signals).toHaveLength(1);

		// Constructed AT the read time, because that is what eviction looks like:
		// the instance is gone and a new one is created by the next request.
		vi.setSystemTime(new Date(T0 + PUBLISHED));
		const replacement = newBoard();
		const view = await replacement.view({ nowMs: T0 + PUBLISHED });
		expect(view.signals).toHaveLength(0);
		expect(view.rebuilding).toBe(true);
	});
});

describe('the view carries nothing a reader could count', () => {
	it('has no numeric field but the tick, and no coordinate', async () => {
		const board = newBoard();
		await reportN(board, 40, T0);
		const view = await board.view({ nowMs: T0 + PUBLISHED });
		for (const [key, value] of Object.entries(view)) {
			if (key === 'tick') continue;
			expect(typeof value, key).not.toBe('number');
		}
		for (const s of view.signals) {
			for (const [key, value] of Object.entries(s)) {
				expect(typeof value, key).not.toBe('number');
			}
		}
		expect(JSON.stringify(view)).not.toMatch(/lat|lng|longitude|coord/i);
	});

	it('renders the band as one of the five words, or null', async () => {
		const board = newBoard();
		await reportN(board, 40, T0);
		const view = await board.view({ nowMs: T0 + PUBLISHED });
		expect(LiveBoard.bands).toContain(view.band as string);
	});

	/** §6.4: bands are disabled ENTIRELY under heightened threat, not coarsened. */
	it('drops the band to null under heightened threat', async () => {
		const board = newBoard();
		await reportN(board, 40, T0);
		expect((await board.viewHeightened(T0 + PUBLISHED)).band).toBeNull();
	});
});

describe('SAFE_EXIT needs a quorum, through the class', () => {
	it('withholds a SAFE_EXIT reported without a quorum', async () => {
		const board = newBoard();
		for (let i = 0; i < DENSITY_FLOOR_D; i++) {
			await board.report({ zoneId: ZONE, signal: 'SAFE_EXIT', dedupToken: tok(i), nowMs: T0 });
		}
		const view = await board.view({ nowMs: T0 + PUBLISHED });
		expect(view.signals.find((s) => s.signal === 'SAFE_EXIT')).toBeUndefined();
	});

	it('shows it once a quorum is attested', async () => {
		const board = newBoard();
		for (let i = 0; i < DENSITY_FLOOR_D; i++) {
			await board.report({
				zoneId: ZONE,
				signal: 'SAFE_EXIT',
				dedupToken: tok(i),
				marshalValid: true,
				nowMs: T0
			});
		}
		const s = (await board.view({ nowMs: T0 + PUBLISHED })).signals.find(
			(x) => x.signal === 'SAFE_EXIT'
		);
		expect(s).toBeDefined();
		expect(s!.marshal_verified).toBe(true);
	});

	/**
	 * A quorum is STICKY. Without this, one unsigned report arriving after a
	 * marshal-attested SAFE_EXIT would suppress it, which hands any single
	 * participant a veto over an evacuation route.
	 */
	it('does not let a later unquorumed report un-attest it', async () => {
		const board = newBoard();
		for (let i = 0; i < DENSITY_FLOOR_D; i++) {
			await board.report({
				zoneId: ZONE,
				signal: 'SAFE_EXIT',
				dedupToken: tok(i),
				marshalValid: true,
				nowMs: T0
			});
		}
		await board.report({ zoneId: ZONE, signal: 'SAFE_EXIT', dedupToken: tok(99), nowMs: T0 });
		expect(
			(await board.view({ nowMs: T0 + PUBLISHED })).signals.find((x) => x.signal === 'SAFE_EXIT')
		).toBeDefined();
	});
});

describe('lazy expiry, with no alarm', () => {
	it('drops a signal once its TTL has passed', async () => {
		const board = newBoard();
		await reportN(board, DENSITY_FLOOR_D, T0);
		expect((await board.view({ nowMs: T0 + PUBLISHED })).signals).toHaveLength(1);
		expect((await board.view({ nowMs: T0 + SIGNAL_TTL_MS + 1 })).signals).toHaveLength(0);
	});
});
