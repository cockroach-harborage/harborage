/**
 * App-layer rate-limit ladder (ARCHITECTURE §17.6, §18.1).
 *
 * WAF custom-characteristic rate limiting is unavailable on the funded plan, so
 * the memory-only RateLimit DO is the deliberate substitute. Volumetric L7 is
 * Cloudflare's managed rulesets; this bounds application abuse.
 *
 * Lifted out of workers/api and workers/media, which held byte-identical copies
 * of `rateOk`/`bucketKey` differing only in the Env type name.
 *
 * The ladder, cheapest and broadest first:
 *
 *   global shard   16 fixed instances. A flood is throttled here before it can
 *                  mint DO instances further down, which is what keeps the
 *                  per-cap tier from becoming an amplification vector.
 *   ASN bucket     one instance per origin network. Isolates a single hostile
 *                  network without touching everyone else.
 *   per-cap-cert   one instance per credential. ALSO holds the PoP nonce set,
 *                  deliberately: a replay carries the same certificate, so it
 *                  lands on the same instance, and the check costs no extra
 *                  round trip.
 *
 * NEVER rate-limit reading public safety information (charter). Every caller
 * here is a mutating endpoint.
 */
import type { DurableObjectNamespace } from '@cloudflare/workers-types';

/** Fixed so a shard id is stable, and small so each instance sees real volume. */
export const GLOBAL_SHARDS = 16;

export type AdmitVerdict = 'ok' | 'rate-limited' | 'replay';

export interface RateLimitStub {
	allow(cost?: number): Promise<boolean>;
	admit(nonceHex: string, retainMs: number, cost?: number): Promise<AdmitVerdict>;
}

export interface RateLimitBindings {
	RATE_LIMIT: DurableObjectNamespace;
}

function stub(env: RateLimitBindings, name: string): RateLimitStub {
	return env.RATE_LIMIT.get(env.RATE_LIMIT.idFromName(name)) as unknown as RateLimitStub;
}

/** First 8 bytes of SHA-256, hex. Never logged, never persisted. */
export async function bucketKey(value: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
	return Array.from(new Uint8Array(digest).slice(0, 8), (b) =>
		b.toString(16).padStart(2, '0')
	).join('');
}

/** Stable shard from an already-hashed key, so retries land consistently. */
export function globalShardFor(hashHex: string): string {
	const first = Number.parseInt(hashHex.slice(0, 2) || '0', 16);
	return `g:${(Number.isNaN(first) ? 0 : first) % GLOBAL_SHARDS}`;
}

/**
 * IP-keyed limit, the M1 behaviour, kept for endpoints that have no credential
 * yet. The IP is hashed and neither logged nor persisted.
 */
export async function rateOk(
	req: { header(name: string): string | undefined },
	env: RateLimitBindings,
	cost = 1
): Promise<boolean> {
	const key = await bucketKey(req.header('CF-Connecting-IP') ?? 'unknown');
	return stub(env, key).allow(cost);
}

/**
 * The broad tiers, run together. They are independent buckets, so one round
 * trip instead of two matters on 2G. A request rejected by one still spends a
 * token in the other, which is intended: a rejected attempt is still load.
 */
export async function broadTiersOk(
	env: RateLimitBindings,
	opts: { keyHashHex: string; asn?: number | undefined; cost?: number }
): Promise<boolean> {
	const cost = opts.cost ?? 1;
	const asnName = `asn:${opts.asn ?? 'unknown'}`;
	const [globalOk, asnOk] = await Promise.all([
		stub(env, globalShardFor(opts.keyHashHex)).allow(cost),
		stub(env, asnName).allow(cost)
	]);
	return globalOk && asnOk;
}

/**
 * Per-credential bucket plus first-use of this PoP nonce, in one atomic DO
 * call. Returns 'replay' only when the bucket allowed the request and the
 * nonce had already been seen.
 */
export async function admitCredential(
	env: RateLimitBindings,
	opts: { certHashHex: string; nonceHex: string; retainMs: number; cost?: number }
): Promise<AdmitVerdict> {
	return stub(env, `cap:${opts.certHashHex}`).admit(opts.nonceHex, opts.retainMs, opts.cost ?? 1);
}

/**
 * Fixed shard count for one-shot admission. A power of two so the first nonce
 * byte maps evenly.
 */
export const ONESHOT_SHARDS = 256;

/**
 * Which shard a one-shot proof lands on. Stable in the nonce, which is the
 * entire point: the SAME nonce always reaches the SAME instance, so a replay
 * necessarily meets the record of its original.
 */
export function oneShotShardFor(nonceHex: string): string {
	const first = Number.parseInt(nonceHex.slice(0, 2) || '0', 16);
	const shard = (Number.isNaN(first) ? 0 : first) % ONESHOT_SHARDS;
	return `one:${shard.toString(16).padStart(2, '0')}`;
}

/**
 * Anti-replay for a request carrying a PER-REQUEST certificate.
 *
 * WHY NOT admitCredential. That function addresses `cap:<certHashHex>`, which is
 * correct for a certificate reused across many requests: the instance is the
 * credential, and the credential's nonces live with it. A one-shot certificate
 * has a fresh hash every time, so the same call would mint a NEW Durable Object
 * per request. That is unbounded instance creation driven by an unauthenticated
 * caller, which is an amplification vector wearing a rate limiter's clothes. It
 * would also silently lose replay detection, because a replayed request carries
 * a certificate hash the system has never seen and so lands somewhere empty.
 *
 * Sharding on the nonce keeps the property that matters. Detection is EXACT,
 * not probabilistic: a replay is by definition the same nonce, the same nonce
 * hashes to the same shard, and that shard's seen-map answers 'replay'. With a
 * 128-bit nonce, two honest clients colliding needs on the order of 2^64
 * requests.
 *
 * THREE HONEST LIMITS, none of which this function fixes:
 *
 *  1. THIS IS NOT A RATE LIMIT AND MUST NOT BE DESCRIBED AS ONE. The shard is
 *     selected by a value the CLIENT chooses. An attacker spreading nonces
 *     uniformly gets ONESHOT_SHARDS times the burst allowance instead of one
 *     bucket's worth; an attacker concentrating them can drain a single shard
 *     and deny it to honest callers. The real volume defence on a one-shot route
 *     is broadTiersOk, whose shard is keyed on a hash of the connecting IP that
 *     the client cannot pick, plus Turnstile, plus the broker's own caps. What
 *     this bucket is, is a memory-exhaustion backstop.
 *  2. A 429 here is retryable with a fresh nonce, which lands on a different
 *     shard with probability (ONESHOT_SHARDS-1)/ONESHOT_SHARDS. That turns the
 *     targeted-shard attack from a denial into a retry, and it only works
 *     because the client mints a new nonce rather than replaying the rejected
 *     one.
 *  3. Nonce eviction under flood forgets early. Filling one shard past the DO's
 *     nonce ceiling evicts a victim's nonce and reopens its replay window for
 *     the remainder of the freshness policy. Same class of limit already
 *     documented on the RateLimit class, bounded by the broad tiers.
 *
 * Salting the shard with a server secret to make it unsteerable was considered
 * and rejected: a new binding is a new failure mode and a new fail-closed path,
 * for a property the broad tiers already own.
 */
export async function admitOneShot(
	env: RateLimitBindings,
	opts: { nonceHex: string; retainMs: number; cost?: number }
): Promise<AdmitVerdict> {
	return stub(env, oneShotShardFor(opts.nonceHex)).admit(
		opts.nonceHex,
		opts.retainMs,
		opts.cost ?? 1
	);
}
