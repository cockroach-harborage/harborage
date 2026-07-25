/**
 * Mailbox DO — one per issued inbox token (ARCHITECTURE §5.3, §9.3).
 *
 * WHOLLY MEMORY-ONLY (gate-memory-only). It never touches storage, D1, R2, or a
 * WebSocket attachment. A queue lost on eviction is CORRECT BEHAVIOUR here, not
 * a gap: the product copy says a brokered message is gone if you close the app,
 * and the alternative is a durable record that two parties exchanged something
 * at a time, which is the record this whole class exists to not have.
 *
 * NO ALARM, AND THE REASON IS NOT STYLE. Setting an alarm reaches the same
 * durable interface the gate forbids, it bills as a row written, and the row is
 * a PITR-visible record that something is pending at time T. A wholly-memory
 * class therefore cannot arm one. Expiry is lazy, at the top of every method,
 * exactly as RateLimit does it, and the delivery clock is the puller's own
 * in-flight request.
 *
 * (Described rather than named, because the gate scans comments.)
 *
 * OBJECT-STORE SPILL IS DEFERRED, BY NAME, TO A LATER MILESTONE. Parking a
 * brokered message in a bucket would create a durable object with a creation
 * timestamp: a record that an exchange happened between two parties at a time,
 * in a store whose retention we do not control and which a lawful order reaches.
 * gate-memory-only bars the bucket binding type in this file, and that is the
 * right answer, not an obstacle to route around.
 */
import { DurableObject } from 'cloudflare:workers';
import { BROKER_FRAME_LEN, POLL_WAIT_TICKS, TICK_MS } from '@harborage/worker-lib/broker';

/** Deliberately small. A mailbox is a handoff point, not an inbox. */
const MAX_QUEUE = 8;
const MAILBOX_TTL_MS = 15 * 60_000;
/**
 * Concurrent long polls per mailbox. Durable Object duration bills wall-clock
 * while a request is in flight, so an unbounded number of parked polls on one
 * instance is a cost amplification as well as a memory one.
 */
const MAX_CONCURRENT_POLLS = 2;

export class Mailbox extends DurableObject {
	private queue: Uint8Array[] = [];
	private expiresAtMs = 0;
	private inFlight = 0;

	/**
	 * Hand a frame to this mailbox. Refuses anything that is not exactly one
	 * frame long: a short frame would reintroduce the size channel that padding
	 * exists to close.
	 */
	async deliver(frame: Uint8Array, nowMs = Date.now()): Promise<'ok' | 'full' | 'bad-frame'> {
		this.expire(nowMs);
		if (frame.length !== BROKER_FRAME_LEN) return 'bad-frame';
		if (this.queue.length >= MAX_QUEUE) return 'full';
		this.queue.push(frame);
		this.expiresAtMs = nowMs + MAILBOX_TTL_MS;
		return 'ok';
	}

	/**
	 * Wait exactly POLL_WAIT_TICKS, then return whatever arrived, or null.
	 *
	 * THE DURATION IS FIXED WHETHER OR NOT THERE IS A MESSAGE. Returning as soon
	 * as one arrives would make round-trip time a perfect presence oracle, and no
	 * amount of length padding repairs that.
	 *
	 * The clock is read ONCE, at entry, and only for expiry. The wait counts
	 * ticks rather than re-reading Date.now(), so correctness does not depend on
	 * how the runtime advances the clock across a timer, and fake timers test it
	 * exactly.
	 *
	 * Holding this request open is also what keeps the instance resident: a
	 * Durable Object with an in-flight request is not evicted.
	 */
	async poll(nowMs = Date.now()): Promise<Uint8Array | null> {
		this.expire(nowMs);
		if (this.inFlight >= MAX_CONCURRENT_POLLS) return null;
		this.inFlight++;
		try {
			let found: Uint8Array | null = null;
			for (let i = 0; i < POLL_WAIT_TICKS; i++) {
				if (!found) found = this.queue.shift() ?? null;
				await new Promise((r) => setTimeout(r, TICK_MS));
			}
			return found;
		} finally {
			this.inFlight--;
		}
	}

	/** Depth, for tests only. Never reachable from a route. */
	async depth(nowMs = Date.now()): Promise<number> {
		this.expire(nowMs);
		return this.queue.length;
	}

	private expire(nowMs: number): void {
		if (this.expiresAtMs !== 0 && nowMs >= this.expiresAtMs) {
			this.queue = [];
			this.expiresAtMs = 0;
		}
	}
}
