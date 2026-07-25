/**
 * Archive primitives (ARCHITECTURE §16).
 *
 * The tests that matter here are the ones guarding a property that is silent
 * when broken: Hamming counted in bits rather than characters, a singleton
 * never receiving a dedup answer, probation never auto-clearing out of HELD, and
 * the absence of any state meaning "beyond reach".
 */
import { describe, expect, it } from 'vitest';
import {
	bandsOf,
	DEFAULT_HAMMING_RADIUS,
	hammingDistance,
	isDhash64,
	isNearDuplicate
} from '../src/archive/dhash.ts';
import { citableId, isCitableId, versionedCitableId } from '../src/archive/citable-id.ts';
import {
	advanceProbation,
	daysBetweenBuckets,
	DEFAULT_PROBATION_DAYS,
	PROBATION_MAX_DAYS,
	PROBATION_MIN_DAYS
} from '../src/archive/probation.ts';
import {
	checkpointReady,
	CHECKPOINT_COHORT_K,
	CHECKPOINT_MAX_DELAY_MS,
	DEDUP_COHORT_K,
	dedupVerdict,
	randomizedInclusionDelayMs
} from '../src/archive/cohort.ts';
import {
	assembleBsaExport,
	STATEMENT_PRESERVATION,
	STATEMENT_UNSIGNED,
	STATEMENT_WEAK_CLAIM
} from '../src/archive/bsa-export.ts';

const SHA_A = 'a'.repeat(64);
/** Differs in the FIRST byte, which is inside the ten-byte anchor. */
const SHA_B = `b${'a'.repeat(63)}`;
/** Differs only past the anchor, so it deliberately shares an id. */
const SHA_TAIL_ONLY = `${'a'.repeat(63)}b`;

describe('perceptual fingerprints', () => {
	it('rejects anything that is not sixteen lowercase hex characters', () => {
		expect(isDhash64('0123456789abcdef')).toBe(true);
		expect(isDhash64('0123456789ABCDEF')).toBe(false);
		expect(isDhash64('0123456789abcde')).toBe(false);
		expect(isDhash64('0123456789abcdeg')).toBe(false);
	});

	it('splits into four bands that reassemble to the original', () => {
		const hash = '0123456789abcdef';
		const bands = bandsOf(hash);
		expect(bands).toHaveLength(4);
		expect(bands.join('')).toBe(hash);
	});

	it('counts Hamming distance in bits, not in characters', () => {
		// '0' against 'f' is ONE differing character and FOUR differing bits. A
		// character-wise implementation passes every other test in this file and
		// silently reports a quarter of the true distance, which tightens the
		// radius until genuine near-duplicates stop matching.
		expect(hammingDistance('0000000000000000', 'f000000000000000')).toBe(4);
		expect(hammingDistance('0000000000000000', '1000000000000000')).toBe(1);
		expect(hammingDistance(SHA_A.slice(0, 16), SHA_A.slice(0, 16))).toBe(0);
	});

	it('finds a near duplicate that differs by a few bits', () => {
		expect(isNearDuplicate('0000000000000000', '0000000000000007')).toBe(true);
	});

	it('treats a wholly different fingerprint as distinct', () => {
		const far = hammingDistance('0000000000000000', 'ffffffffffffffff');
		expect(far).toBe(64);
		expect(isNearDuplicate('0000000000000000', 'ffffffffffffffff')).toBe(false);
		expect(far).toBeGreaterThan(DEFAULT_HAMMING_RADIUS);
	});
});

describe('the citable identifier', () => {
	it('derives the same id from the same digest every time', () => {
		expect(citableId(SHA_A)).toBe(citableId(SHA_A));
	});

	it('derives a different id from a digest differing inside the anchor', () => {
		expect(citableId(SHA_A)).not.toBe(citableId(SHA_B));
	});

	it('depends on the first ten bytes only, and says so', () => {
		// Two different files whose digests agree for ten bytes share an id. That
		// is the honest consequence of a short readable identifier, and it is why
		// original_sha256 rather than citable_id is the integrity anchor
		// everywhere: the id is for citing, never for proving.
		expect(citableId(SHA_A)).toBe(citableId(SHA_TAIL_ONLY));
	});

	it('uses ten bytes, so the id is sixteen base32 characters', () => {
		const id = citableId(SHA_A);
		expect(id.startsWith('HRB-')).toBe(true);
		expect(id.slice(4)).toHaveLength(16);
		expect(isCitableId(id)).toBe(true);
	});

	it('versions a re-rendered derivative without changing evidentiary identity', () => {
		const id = citableId(SHA_A);
		expect(versionedCitableId(id, 1)).toBe(id);
		expect(versionedCitableId(id, 2)).toBe(`${id}.v2`);
		// The base still resolves, so a citation in a filing keeps pointing at
		// the same original.
		expect(versionedCitableId(id, 2).startsWith(id)).toBe(true);
		expect(isCitableId(versionedCitableId(id, 3))).toBe(true);
	});

	it('refuses a digest that is not a sha256', () => {
		expect(() => citableId('abc')).toThrow();
	});
});

describe('the probation window', () => {
	const base = { createdBucket: '2026-01-01', rescanHit: false, openDisputes: 0 } as const;

	it('does not clear before the window elapses', () => {
		const d = advanceProbation({ ...base, state: 'OPEN', todayBucket: '2026-02-01' });
		expect(d.state).toBe('OPEN');
		expect(d.reasons).toContain('window_open');
	});

	it('holds on a re-scan hit and never auto-clears out of held', () => {
		const hit = advanceProbation({ ...base, state: 'OPEN', todayBucket: '2026-01-10', rescanHit: true });
		expect(hit.state).toBe('HELD');
		// A later clean scan, long after the window, must NOT release it. Only a
		// human may decide a known-bad match was wrong.
		const later = advanceProbation({ ...base, state: 'HELD', todayBucket: '2027-01-01' });
		expect(later.state).toBe('HELD');
		expect(later.reasons).toContain('held_awaiting_human');
	});

	it('does not clear while an objection is open, whatever the clock says', () => {
		const d = advanceProbation({
			...base,
			state: 'OPEN',
			todayBucket: '2027-01-01',
			openDisputes: 1
		});
		expect(d.state).toBe('OPEN');
		expect(d.reasons).toContain('dispute_open');
	});

	it('clears once the window elapses with nothing found', () => {
		const d = advanceProbation({ ...base, state: 'OPEN', todayBucket: '2026-06-01' });
		expect(d.state).toBe('CLEARED');
		expect(d.nextDueBucket).toBeNull();
	});

	it('defaults to the long window, because certainty grows with time', () => {
		expect(DEFAULT_PROBATION_DAYS).toBe(PROBATION_MAX_DAYS);
		expect(PROBATION_MIN_DAYS).toBeLessThan(PROBATION_MAX_DAYS);
	});

	it('has no state that means beyond reach', () => {
		// Three members, and none of them is terminal. A fourth value meaning
		// "can no longer be removed" is precisely what §16 refuses to build.
		const states = new Set<string>();
		for (const today of ['2026-01-02', '2026-06-01', '2027-01-01']) {
			for (const hit of [true, false]) {
				for (const disputes of [0, 1]) {
					for (const state of ['OPEN', 'CLEARED', 'HELD'] as const) {
						states.add(
							advanceProbation({ ...base, state, todayBucket: today, rescanHit: hit, openDisputes: disputes })
								.state
						);
					}
				}
			}
		}
		expect([...states].sort()).toEqual(['CLEARED', 'HELD', 'OPEN']);
	});

	it('measures whole days between buckets', () => {
		expect(daysBetweenBuckets('2026-01-01', '2026-01-31')).toBe(30);
		expect(daysBetweenBuckets('2026-01-31', '2026-01-01')).toBe(0);
	});
});

describe('the cohort guards', () => {
	it('answers upload for a singleton, so an obscure hash gets no existence oracle', () => {
		expect(dedupVerdict(1)).toBe('upload');
	});

	it('never answers skip below the threshold, across the whole range', () => {
		for (let seen = 0; seen < DEDUP_COHORT_K; seen++) {
			expect(dedupVerdict(seen)).toBe('upload');
		}
	});

	it('answers skip only once the cohort threshold is met', () => {
		expect(dedupVerdict(DEDUP_COHORT_K)).toBe('skip');
		expect(dedupVerdict(DEDUP_COHORT_K + 50)).toBe('skip');
	});

	it('holds a lone item out of a checkpoint until the delay ceiling', () => {
		const now = 1_700_000_000_000;
		expect(checkpointReady({ pending: 1, oldestPendingMs: now - 1000, nowMs: now })).toBe(false);
		expect(
			checkpointReady({ pending: 1, oldestPendingMs: now - CHECKPOINT_MAX_DELAY_MS, nowMs: now })
		).toBe(true);
	});

	it('folds a full cohort in immediately', () => {
		const now = 1_700_000_000_000;
		expect(
			checkpointReady({ pending: CHECKPOINT_COHORT_K, oldestPendingMs: now - 1, nowMs: now })
		).toBe(true);
	});

	it('never checkpoints an empty set', () => {
		expect(checkpointReady({ pending: 0, oldestPendingMs: 0, nowMs: 1_700_000_000_000 })).toBe(false);
	});

	it('randomizes the lone-item delay rather than adding a constant', () => {
		// A fixed delay is the submission time plus a constant, which is the same
		// timing oracle with an offset.
		const low = randomizedInclusionDelayMs(() => 0);
		const high = randomizedInclusionDelayMs(() => 0.999);
		expect(high).toBeGreaterThan(low);
		expect(high).toBeLessThanOrEqual(CHECKPOINT_MAX_DELAY_MS);
		expect(low).toBeGreaterThan(0);
	});
});

describe('the section 63 export artifact', () => {
	const base = {
		anchor: 'c'.repeat(64),
		citableId: citableId('c'.repeat(64)),
		custodyLines: [],
		builtBucket: '2026-07-25'
	};

	it('never asserts a vaulted original when the bytes were never vaulted', () => {
		for (const status of ['none', 'on_device_only', 'vaulting', 'lost']) {
			const out = assembleBsaExport({ ...base, originalStatus: status });
			expect(out.custody_strength).toBe('registered_hash_only');
			expect(out.statements).toContain(STATEMENT_WEAK_CLAIM);
		}
	});

	it('asserts the stronger claim only once the vault confirmed the bytes', () => {
		const out = assembleBsaExport({ ...base, originalStatus: 'vaulted' });
		expect(out.custody_strength).toBe('vaulted_original');
		expect(out.statements).not.toContain(STATEMENT_WEAK_CLAIM);
	});

	it('carries the preservation sentence verbatim, whatever the custody strength', () => {
		for (const status of ['vaulted', 'lost']) {
			expect(assembleBsaExport({ ...base, originalStatus: status }).statements).toContain(
				STATEMENT_PRESERVATION
			);
		}
	});

	it('promises nothing about admissibility, in any statement', () => {
		const out = assembleBsaExport({ ...base, originalStatus: 'vaulted' });
		const text = out.statements.join(' ').toLowerCase();
		for (const overclaim of ['is admissible', 'will be accepted', 'proves', 'court accepts']) {
			expect(text).not.toContain(overclaim);
		}
		expect(text).toContain('not a guarantee');
	});

	it('emits an empty signature list from every input', () => {
		// The platform assembles; a person in charge and a qualified expert sign
		// off-platform. A server that could mint one would be forging them.
		for (const status of ['vaulted', 'on_device_only']) {
			expect(assembleBsaExport({ ...base, originalStatus: status }).signatures).toEqual([]);
		}
	});

	it('reports no external anchor unless one is explicitly supplied', () => {
		expect(assembleBsaExport({ ...base, originalStatus: 'vaulted' }).externally_anchored).toBe(false);
	});

	it('puts the limit on what we hold before the custody lines, not after', () => {
		const out = assembleBsaExport({ ...base, originalStatus: 'lost' });
		expect(out.statements.indexOf(STATEMENT_WEAK_CLAIM)).toBeLessThan(
			out.statements.indexOf(STATEMENT_UNSIGNED)
		);
	});
});
