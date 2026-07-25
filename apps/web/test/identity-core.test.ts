import { describe, expect, it } from 'vitest';
import {
	BACKUP_WORD_COUNT,
	CONFIRM_WORD_COUNT,
	canEnableKeepWords,
	checkConfirmAnswers,
	fingerprint,
	mnemonicWords,
	normalizeMnemonic,
	pickConfirmPositions,
	tierCanSign,
	wordsAreOnDevice
} from '../src/lib/identity-core.ts';

const WORDS = [
	'abandon',
	'ability',
	'able',
	'about',
	'above',
	'absent',
	'absorb',
	'abstract',
	'absurd',
	'abuse',
	'access',
	'accident'
];

describe('normalizeMnemonic', () => {
	// A person copying words off paper on a cheap phone, under stress, will hit
	// every one of these. None of them should be why an account is unrecoverable.
	it('forgives what a phone keyboard does to a typed phrase', () => {
		expect(normalizeMnemonic('  Abandon   ABILITY\tAble\n')).toBe('abandon ability able');
		expect(normalizeMnemonic('abandon ability')).toBe('abandon ability');
		expect(normalizeMnemonic('abandon, ability. able')).toBe('abandon ability able');
		expect(normalizeMnemonic('abandon1 ability')).toBe('abandon ability');
	});

	it('is idempotent', () => {
		const once = normalizeMnemonic('  Abandon   ABILITY ');
		expect(normalizeMnemonic(once)).toBe(once);
	});

	it('returns no words for empty or junk-only input', () => {
		expect(mnemonicWords('')).toEqual([]);
		expect(mnemonicWords('   ')).toEqual([]);
		expect(mnemonicWords('123 456')).toEqual([]);
	});
});

describe('pickConfirmPositions', () => {
	const seq = (values: number[]) => {
		let i = 0;
		return () => values[i++] ?? 0;
	};

	it('picks the requested count without repeats', () => {
		const picked = pickConfirmPositions(BACKUP_WORD_COUNT, CONFIRM_WORD_COUNT, seq([0, 0, 0]));
		expect(picked).toHaveLength(CONFIRM_WORD_COUNT);
		expect(new Set(picked).size).toBe(CONFIRM_WORD_COUNT);
	});

	// Asking for word 9, then 2, then 7 makes someone hunt up and down a list
	// they just wrote by hand. Ascending is the whole reason this sorts.
	it('returns positions in ascending order', () => {
		const picked = pickConfirmPositions(12, 3, seq([9, 1, 4]));
		expect(picked).toEqual([...picked].sort((a, b) => a - b));
	});

	it('never picks the same position twice even when the draw repeats', () => {
		const picked = pickConfirmPositions(12, 3, seq([5, 5, 5]));
		expect(new Set(picked).size).toBe(3);
	});

	it('stays in range for every position it returns', () => {
		for (let trial = 0; trial < 50; trial++) {
			const picked = pickConfirmPositions(12, 3, (max) => Math.floor(Math.random() * max));
			for (const p of picked) {
				expect(p).toBeGreaterThanOrEqual(0);
				expect(p).toBeLessThan(12);
			}
		}
	});

	it('degrades safely when asked for more than exist', () => {
		expect(pickConfirmPositions(3, 10, seq([0, 0, 0]))).toHaveLength(3);
		expect(pickConfirmPositions(0, 3, seq([0]))).toEqual([]);
	});
});

describe('checkConfirmAnswers', () => {
	it('accepts the right words with sloppy typing', () => {
		expect(checkConfirmAnswers(WORDS, [0, 5, 11], ['Abandon', ' absent ', 'ACCIDENT'])).toBe(true);
	});

	it('rejects a wrong word, a short answer set, and an empty challenge', () => {
		expect(checkConfirmAnswers(WORDS, [0, 5, 11], ['abandon', 'absent', 'wrong'])).toBe(false);
		expect(checkConfirmAnswers(WORDS, [0, 5, 11], ['abandon', 'absent'])).toBe(false);
		// An empty position list would otherwise vacuously pass `every`, which
		// would let a caller with a bug skip the confirmation entirely.
		expect(checkConfirmAnswers(WORDS, [], [])).toBe(false);
	});

	it('rejects answers in the wrong order', () => {
		expect(checkConfirmAnswers(WORDS, [0, 5, 11], ['accident', 'absent', 'abandon'])).toBe(false);
	});

	it('rejects an out-of-range position rather than matching undefined', () => {
		expect(checkConfirmAnswers(WORDS, [99], ['abandon'])).toBe(false);
		expect(checkConfirmAnswers(WORDS, [99], [''])).toBe(false);
	});
});

describe('fingerprint', () => {
	it('renders the first 8 bytes in readable groups', () => {
		const key = Uint8Array.from([0xa1, 0xb2, 0xc3, 0xd4, 0xe5, 0xf6, 0x07, 0x18, 0x99]);
		expect(fingerprint(key)).toBe('A1B2 C3D4 E5F6 0718');
	});

	it('differs for different keys', () => {
		expect(fingerprint(new Uint8Array(32).fill(1))).not.toBe(fingerprint(new Uint8Array(32).fill(2)));
	});
});

describe('custody tier and backup state', () => {
	it('lets only the read-only tier be unable to sign', () => {
		expect(tierCanSign('secure-curve')).toBe(true);
		expect(tierCanSign('p256')).toBe(true);
		expect(tierCanSign('memory-only')).toBe(false);
	});

	it('knows when the words are still on the phone', () => {
		expect(wordsAreOnDevice('pending')).toBe(true);
		expect(wordsAreOnDevice('kept')).toBe(true);
		expect(wordsAreOnDevice('erased')).toBe(false);
	});

	// Offering a toggle that silently does nothing is worse than not offering
	// it: the user believes the words are recoverable when they are gone.
	it('refuses to re-enable keep-words once the words are erased', () => {
		expect(canEnableKeepWords('pending')).toBe(true);
		expect(canEnableKeepWords('kept')).toBe(true);
		expect(canEnableKeepWords('erased')).toBe(false);
	});
});
