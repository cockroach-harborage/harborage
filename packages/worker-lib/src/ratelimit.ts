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
	return Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join(
		''
	);
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
	return stub(env, `cap:${opts.certHashHex}`).admit(
		opts.nonceHex,
		opts.retainMs,
		opts.cost ?? 1
	);
}
