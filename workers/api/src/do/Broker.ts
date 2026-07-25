/**
 * Broker DO — one per (region, category) (ARCHITECTURE §5.3; PRD §4.7–4.9).
 *
 * Content-blind. It sees a coarse region, a closed category, an opaque
 * commitment, and sealed boxes it holds no key for. It never sees who is asking,
 * what they need, or where they are beyond a state-level bucket held in memory
 * for minutes.
 *
 * WHOLLY MEMORY-ONLY (gate-memory-only). No durable store of any kind, no D1,
 * no R2, no WebSocket attachment, and NO ALARM. Setting an alarm reaches the
 * same durable interface the gate forbids, it bills as a row written, and the
 * row is a PITR-visible record that something is pending at time T. Expiry is
 * therefore lazy at the top of every method, the RateLimit pattern, and the
 * clock is the puller's own in-flight request.
 *
 * (This comment describes the forbidden call rather than naming it, because the
 * gate scans comments. Same discipline gate-sealed-body imposes on unseal-shaped
 * binding names: reword the comment, never loosen the pattern.)
 *
 * R2 SPILL IS DEFERRED, BY NAME, TO A LATER MILESTONE. A brokered message parked
 * in a bucket is a durable object with a creation timestamp: a record that an
 * exchange happened between two parties at a time, in a store whose retention we
 * do not control and which a lawful order reaches. Losing a queue on eviction is
 * the correct behaviour, and the product copy says so.
 *
 * ALSO: nothing brokered goes on a Queue. Queue messages are retained for days.
 * The life-safety queue carries content-free operational signals only.
 */
import { DurableObject } from 'cloudflare:workers';
import {
	BROKER_FRAME_LEN,
	COMMIT_LEN,
	HANDLE_LEN,
	tickOf,
	type AidCategory
} from '@harborage/worker-lib/broker';

const NEED_TTL_MS = 15 * 60_000;
/** How long one responder holds a need before it returns to the queue. */
const RESERVATION_MS = 3 * 60_000;
const MAX_NEEDS = 500;
/**
 * Acceptances one responder inbox may make.
 *
 * HONEST LIMIT: this keys on an inbox handle, and a responder can mint a fresh
 * one-shot identity and a fresh inbox per acceptance. It is friction against a
 * lazy scraper, not a bound on a determined one. The bound is the broad rate
 * ladder plus Turnstile on the announce routes.
 */
const MAX_ACCEPTS_PER_HELPER = 3;

function hex(bytes: Uint8Array): string {
	let s = '';
	for (const b of bytes) s += b.toString(16).padStart(2, '0');
	return s;
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
	return diff === 0;
}

interface Need {
	category: AidCategory;
	/** SHA-256 of a secret only the seeker knows. */
	commit: Uint8Array;
	seekerInbox: string;
	reservedBy: string | null;
	reservedUntilMs: number;
	/** The responder's sealed card, held rather than delivered. */
	held: Uint8Array | null;
	/** The tick in which `held` was recorded. */
	acceptTick: number;
	accepted: boolean;
	expiresAtMs: number;
}

/** Non-cryptographic jitter for the delivery grid. Never persisted. */
function randomOffsetMs(): number {
	const b = new Uint8Array(2);
	crypto.getRandomValues(b);
	return (((b[0] ?? 0) << 8) | (b[1] ?? 0)) % 5_000;
}

export class Broker extends DurableObject {
	private readonly offsetMs = randomOffsetMs();
	private needs = new Map<string, Need>();
	/** Insertion order, and nothing else. Membership never means "claimable". */
	private order: string[] = [];
	private acceptsByHelper = new Map<string, number>();

	/** Announce an open need. Returns its handle, or 'full'. */
	async openNeed(
		input: { category: AidCategory; commit: Uint8Array; seekerInbox: string; handle: Uint8Array },
		nowMs = Date.now()
	): Promise<{ handleHex: string } | 'full' | 'bad-input'> {
		this.expire(nowMs);
		if (input.commit.length !== COMMIT_LEN || input.handle.length !== HANDLE_LEN)
			return 'bad-input';
		if (this.needs.size >= MAX_NEEDS) return 'full';
		const handleHex = hex(input.handle);
		this.needs.set(handleHex, {
			category: input.category,
			commit: input.commit.slice(),
			seekerInbox: input.seekerInbox,
			reservedBy: null,
			reservedUntilMs: 0,
			held: null,
			acceptTick: -1,
			accepted: false,
			expiresAtMs: nowMs + NEED_TTL_MS
		});
		this.order.push(handleHex);
		return { handleHex };
	}

	/**
	 * Hand ONE waiting need to ONE responder, and reserve it.
	 *
	 * One responder at a time is a safety property, not a fairness one. A need
	 * visible to many responders at once is a need many strangers are converging
	 * on, and the seeker has no way to tell which of them is real.
	 */
	async claimNeed(
		helperInbox: string,
		category: AidCategory,
		nowMs = Date.now()
	): Promise<{ handleHex: string; commit: Uint8Array } | null> {
		this.expire(nowMs);
		for (const handleHex of this.order) {
			const need = this.needs.get(handleHex);
			if (!need || need.category !== category) continue;
			// THE RESERVATION IS THE MECHANISM, and it is deliberately the only one.
			//
			// An earlier draft also removed the need from a pending list on claim,
			// which meant the list, not this line, was what stopped a second
			// responder. Deleting this condition left the "one responder at a time"
			// test green, because the removal was doing the work while the
			// condition sat unreachable. An unreachable guard is worse than none:
			// it reads as protection.
			//
			// So there is no second list to fall out of. `order` is insertion order
			// and nothing else, and a need is claimable exactly when no live
			// reservation covers it.
			if (need.reservedBy !== null && need.reservedUntilMs > nowMs) continue;
			if (need.accepted) continue;
			need.reservedBy = helperInbox;
			need.reservedUntilMs = nowMs + RESERVATION_MS;
			return { handleHex, commit: need.commit };
		}
		return null;
	}

	/**
	 * Record a responder's sealed card against a need. It is HELD, not delivered.
	 *
	 * Delivery waits for the seeker to prove continued presence by producing the
	 * preimage of their own commitment, on a separately-ticked request.
	 */
	async accept(
		handleHex: string,
		helperInbox: string,
		frame: Uint8Array,
		nowMs = Date.now()
	): Promise<'ok' | 'taken' | 'unknown' | 'capped' | 'bad-frame'> {
		this.expire(nowMs);
		if (frame.length !== BROKER_FRAME_LEN) return 'bad-frame';
		const need = this.needs.get(handleHex);
		if (!need) return 'unknown';
		if (need.reservedBy !== helperInbox || need.reservedUntilMs <= nowMs) return 'taken';
		if (need.accepted) return 'taken';

		const used = this.acceptsByHelper.get(helperInbox) ?? 0;
		if (used >= MAX_ACCEPTS_PER_HELPER) return 'capped';
		this.acceptsByHelper.set(helperInbox, used + 1);

		need.held = frame;
		need.acceptTick = tickOf(nowMs, this.offsetMs);
		need.accepted = true;
		return 'ok';
	}

	/**
	 * Release the held card to the seeker, on two conditions.
	 *
	 * WHAT THIS MECHANISM ACTUALLY BUYS, stated honestly, because PRD §4.9 calls
	 * it "verify need provenance before any helper is exposed" and IT IS NOT
	 * THAT. Whoever planted a fake need also chose the secret, so producing the
	 * preimage costs them one extra round trip and nothing else. The honest name
	 * is PROOF OF CONTINUED PRESENCE, and what it genuinely provides is:
	 *
	 *   1. A commitment fixed at need-creation, so a reveal cannot be moved onto
	 *      a different need.
	 *   2. Two time-separated, individually rate-limited requests per exposure,
	 *      which makes mass enumeration linear in wall-clock ticks rather than
	 *      free, and makes the second request separately observable.
	 *   3. Deliberateness: exposure is an explicit act by the need's author, never
	 *      an automatic consequence of having posted a need.
	 *
	 * Real provenance is vetting, and PINNED_VETTING_ISSUERS ships empty. Do not
	 * write copy that claims otherwise: overclaiming here gets a lawyer arrested.
	 *
	 * THE TICK COMPARISON IS NOT DECORATION. Without it a client could accept and
	 * reveal in one burst, collapsing the two requests into one round trip and
	 * removing every property above. It is the guard a reviewer is most likely to
	 * simplify away, so its test is named for it.
	 */
	async reveal(
		handleHex: string,
		preimage: Uint8Array,
		nowMs = Date.now()
	): Promise<Uint8Array | null> {
		this.expire(nowMs);
		const need = this.needs.get(handleHex);
		if (!need || !need.held) return null;

		const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', preimage as BufferSource));
		if (!equalBytes(digest, need.commit)) return null;
		if (tickOf(nowMs, this.offsetMs) === need.acceptTick) return null;

		const frame = need.held;
		need.held = null; // single-shot
		return frame;
	}

	/** Keep this instance resident while a counterpart is polling its mailbox. */
	async keepalive(nowMs = Date.now()): Promise<void> {
		this.expire(nowMs);
	}

	/** Open-need count, for tests only. Never reachable from a route. */
	async openCount(nowMs = Date.now()): Promise<number> {
		this.expire(nowMs);
		return this.needs.size;
	}

	/**
	 * Drop aged-out needs. A lapsed reservation needs no handling here: claimNeed
	 * asks whether a LIVE reservation covers the need, so one that has run out is
	 * claimable again by the passage of time alone. That is the whole benefit of
	 * having one mechanism instead of two.
	 */
	private expire(nowMs: number): void {
		for (const [handleHex, need] of this.needs) {
			if (need.expiresAtMs <= nowMs) {
				this.needs.delete(handleHex);
				const at = this.order.indexOf(handleHex);
				if (at >= 0) this.order.splice(at, 1);
			}
		}
	}
}
