/**
 * RateLimit DO (ARCHITECTURE §17.5, §18.1). The deliberate app-layer substitute
 * for WAF custom-characteristic rate-limiting (unavailable on the funded plan).
 *
 * WHOLLY MEMORY-ONLY (gate-memory-only): this class never touches durable
 * storage — token buckets live in an instance field, so nothing is persisted and
 * there is no compellable 30-day PITR record. Buckets reset on eviction; that is
 * an accepted, honest weakening, never a silent "persist for reliability".
 */
import { DurableObject } from 'cloudflare:workers';

const CAPACITY = 30; // burst allowance
const REFILL_PER_SEC = 0.5; // sustained rate

export class RateLimit extends DurableObject {
	private tokens = CAPACITY;
	private lastMs = 0; // 0 = not yet initialized

	/** Consume `cost` tokens. Returns false when the bucket is empty. */
	async allow(cost = 1): Promise<boolean> {
		const now = Date.now();
		if (this.lastMs === 0) this.lastMs = now;
		const elapsed = (now - this.lastMs) / 1000;
		this.tokens = Math.min(CAPACITY, this.tokens + elapsed * REFILL_PER_SEC);
		this.lastMs = now;
		if (this.tokens >= cost) {
			this.tokens -= cost;
			return true;
		}
		return false;
	}
}
