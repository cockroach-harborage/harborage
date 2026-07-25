/**
 * RateLimit DO (ARCHITECTURE §17.5, §17.6, §18.1). The deliberate app-layer
 * substitute for WAF custom-characteristic rate-limiting (unavailable on the
 * funded plan), and the anti-replay memory for per-request proofs.
 *
 * WHOLLY MEMORY-ONLY (gate-memory-only): this class never touches durable
 * state — token buckets and seen-nonces live in instance fields, so nothing is
 * persisted and there is no compellable 30-day PITR record. Both reset on
 * eviction; that is an accepted, honest weakening, never a silent "persist for
 * reliability".
 *
 * HONEST LIMIT on anti-replay: an evicted instance forgets its nonces, so a
 * proof captured moments before eviction could be replayed inside its short
 * freshness window. Making nonces durable would create exactly the compellable
 * per-request record the charter forbids, and would tie a nonce to a
 * credential in storage. Eviction is the correct trade; the exposure is
 * bounded by the PoP freshness policy, not by this memory.
 *
 * Instances are addressed by the caller (worker-lib/ratelimit.ts): 16 fixed
 * global shards, one per ASN, and one per credential. The per-credential
 * instance holds that credential's nonces, so a replay necessarily lands on
 * the same instance as the original.
 */
import { DurableObject } from 'cloudflare:workers';

const CAPACITY = 30; // burst allowance
const REFILL_PER_SEC = 0.5; // sustained rate

/**
 * Hard ceiling on remembered nonces. A memory-only DO that grows without bound
 * hits a silent out-of-memory kill under surge, which would take the limiter
 * down exactly when it is needed most. Oldest entries go first.
 */
const MAX_NONCES = 20_000;

export type AdmitVerdict = 'ok' | 'rate-limited' | 'replay';

export class RateLimit extends DurableObject {
	private tokens = CAPACITY;
	private lastMs = 0; // 0 = not yet initialized
	/** nonce hex -> ms after which it may be forgotten. Insertion-ordered. */
	private seen = new Map<string, number>();

	/** Consume `cost` tokens. Returns false when the bucket is empty. */
	async allow(cost = 1): Promise<boolean> {
		return this.take(cost, Date.now());
	}

	/**
	 * Token bucket AND first-use of a proof nonce, in one call.
	 *
	 * Order is deliberate. The bucket is charged first, so replaying a captured
	 * proof costs an attacker budget rather than being a free probe. The nonce
	 * is recorded only once the request is admitted, so a rate-limited attempt
	 * does not burn the nonce of a client that will legitimately retry.
	 *
	 * There is no `await` between reading and writing state, so this runs as one
	 * uninterrupted turn and no other request can interleave into the middle of
	 * the check-then-set.
	 */
	async admit(nonceHex: string, retainMs: number, cost = 1): Promise<AdmitVerdict> {
		const now = Date.now();
		if (!this.take(cost, now)) return 'rate-limited';

		this.sweep(now);
		const until = this.seen.get(nonceHex);
		if (until !== undefined && until > now) return 'replay';

		this.seen.set(nonceHex, now + Math.max(0, retainMs));
		this.evictOverflow();
		return 'ok';
	}

	private take(cost: number, now: number): boolean {
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

	/**
	 * Drop entries past their retention. A Map iterates in insertion order and
	 * retention is uniform per endpoint, so expired entries are at the front and
	 * this stops at the first live one instead of walking the whole map.
	 */
	private sweep(now: number): void {
		for (const [nonce, until] of this.seen) {
			if (until > now) break;
			this.seen.delete(nonce);
		}
	}

	private evictOverflow(): void {
		while (this.seen.size > MAX_NONCES) {
			const oldest = this.seen.keys().next();
			if (oldest.done) break;
			this.seen.delete(oldest.value);
		}
	}
}
