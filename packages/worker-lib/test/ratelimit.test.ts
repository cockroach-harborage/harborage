import { describe, expect, it } from 'vitest';
import {
	admitCredential,
	admitOneShot,
	oneShotShardFor,
	ONESHOT_SHARDS,
	type AdmitVerdict
} from '../src/ratelimit.ts';

/**
 * A namespace that records every instance name it is asked for, and a per-name
 * seen-set standing in for the DO's nonce memory. The recording is the point:
 * these tests assert HOW MANY instances a call pattern creates, which is a fact
 * about addressing that no status code reveals.
 */
function spyEnv() {
	const names: string[] = [];
	const seen = new Map<string, Set<string>>();
	const env = {
		RATE_LIMIT: {
			idFromName(name: string) {
				names.push(name);
				return { name };
			},
			get(id: { name: string }) {
				return {
					async admit(nonceHex: string): Promise<AdmitVerdict> {
						const bucket = seen.get(id.name) ?? new Set<string>();
						seen.set(id.name, bucket);
						if (bucket.has(nonceHex)) return 'replay';
						bucket.add(nonceHex);
						return 'ok';
					},
					async allow() {
						return true;
					}
				};
			}
		}
	} as never;
	return { env, names, distinct: () => new Set(names) };
}

/** Deterministic 16-byte nonces, so a failure is reproducible. */
function nonceHex(i: number): string {
	let s = '';
	let x = (i * 2654435761) >>> 0;
	for (let b = 0; b < 16; b++) {
		x = (x * 1103515245 + 12345) >>> 0;
		s += ((x >>> 16) & 0xff).toString(16).padStart(2, '0');
	}
	return s;
}

describe('oneShotShardFor', () => {
	/**
	 * THE REPLAY GUARANTEE. Detection works only because the same nonce always
	 * lands on the same instance. Make the shard depend on anything else that
	 * varies per request and a replay quietly reaches an empty bucket.
	 */
	it('is stable in the nonce', () => {
		for (let i = 0; i < 200; i++) {
			const n = nonceHex(i);
			expect(oneShotShardFor(n)).toBe(oneShotShardFor(n));
		}
	});

	it('is decided by the leading byte only', () => {
		expect(oneShotShardFor('ab' + '00'.repeat(15))).toBe(oneShotShardFor('ab' + 'ff'.repeat(15)));
		expect(oneShotShardFor('ab00')).not.toBe(oneShotShardFor('cd00'));
	});

	it('never throws on a malformed nonce', () => {
		expect(oneShotShardFor('')).toMatch(/^one:[0-9a-f]{2}$/);
		expect(oneShotShardFor('zz')).toMatch(/^one:[0-9a-f]{2}$/);
	});
});

describe('admitOneShot addressing', () => {
	/**
	 * THE AMPLIFICATION TEST, and the reason admitOneShot exists at all.
	 *
	 * admitCredential addresses `cap:<certHashHex>`. With a per-request
	 * certificate that hash is fresh every time, so the same call would mint a
	 * new Durable Object per request: unbounded instance creation driven by an
	 * unauthenticated caller.
	 *
	 * This cannot pass for the wrong reason because it asserts a COUNT of
	 * distinct instance names, not a status. Revert admitOneShot to the
	 * cap:-addressed form and it reports 1000 names instead of at most 256.
	 */
	it('creates at most ONESHOT_SHARDS instances across a thousand requests', async () => {
		const { env, names, distinct } = spyEnv();
		for (let i = 0; i < 1000; i++) {
			await admitOneShot(env, { nonceHex: nonceHex(i), retainMs: 60_000 });
		}
		expect(names).toHaveLength(1000);
		for (const n of names) expect(n).toMatch(/^one:[0-9a-f]{2}$/);
		expect(distinct().size).toBeLessThanOrEqual(ONESHOT_SHARDS);
	});

	/**
	 * The negative control for the test above. A constant shard would satisfy
	 * "at most 256" while making the limiter a single global bucket, so this
	 * pins the other side: the traffic must actually spread.
	 */
	it('spreads across many shards rather than collapsing to one', async () => {
		const { env, distinct } = spyEnv();
		for (let i = 0; i < 4096; i++) {
			await admitOneShot(env, { nonceHex: nonceHex(i), retainMs: 60_000 });
		}
		expect(distinct().size).toBeGreaterThan(200);
	});

	/** Contrast: the cached path is addressed by the credential, as it should be. */
	it('admitCredential still addresses by certificate hash', async () => {
		const { env, names } = spyEnv();
		await admitCredential(env, {
			certHashHex: 'ff'.repeat(32),
			nonceHex: nonceHex(1),
			retainMs: 60_000
		});
		expect(names).toEqual([`cap:${'ff'.repeat(32)}`]);
	});
});

describe('admitOneShot replay detection', () => {
	it('sees a replayed nonce, because it lands on the same instance', async () => {
		const { env } = spyEnv();
		const n = nonceHex(7);
		expect(await admitOneShot(env, { nonceHex: n, retainMs: 60_000 })).toBe('ok');
		expect(await admitOneShot(env, { nonceHex: n, retainMs: 60_000 })).toBe('replay');
	});

	/**
	 * Honest limit made explicit: a retry with a FRESH nonce is admitted, which
	 * is what turns a drained shard into a retry rather than a denial. It is also
	 * why the client must mint a new nonce on retry instead of resending.
	 */
	it('admits a retry that carries a fresh nonce', async () => {
		const { env } = spyEnv();
		expect(await admitOneShot(env, { nonceHex: nonceHex(11), retainMs: 60_000 })).toBe('ok');
		expect(await admitOneShot(env, { nonceHex: nonceHex(12), retainMs: 60_000 })).toBe('ok');
	});
});
