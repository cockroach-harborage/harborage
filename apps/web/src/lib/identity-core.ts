/**
 * Pure identity helpers. IMPORTS NOTHING, deliberately.
 *
 * apps/web/vitest.config.ts collects only test/**, with no $lib alias, no
 * plugins and no DOM, so anything unit-tested here has to stand alone. Same
 * split as verification-map.ts against verification.ts: the logic worth
 * asserting lives here, and IndexedDB, WebCrypto and paraglide stay in
 * identity.ts and the page.
 *
 * Nothing in this file touches key material.
 */

export const BACKUP_WORD_COUNT = 12;
/** How many words the user re-types to prove the phrase was written down. */
export const CONFIRM_WORD_COUNT = 3;

/**
 * What the device can hold. Mirrors CustodyTier in @harborage/crypto/device-keys,
 * duplicated here only because this module imports nothing; identity.ts asserts
 * the two agree.
 */
export type CustodyTier = 'secure-curve' | 'p256' | 'memory-only';

/** Only the read-only tier cannot sign, and it says so rather than failing late. */
export function tierCanSign(tier: CustodyTier): boolean {
	return tier !== 'memory-only';
}

/**
 * Normalise a phrase the user typed or pasted. Phones insert autocapitalisation,
 * curly punctuation and non-breaking spaces, and a person under stress copying
 * words off paper will add stray whitespace. None of that should be the reason
 * an account cannot be restored.
 */
export function normalizeMnemonic(raw: string): string {
	return raw
		.normalize('NFKD')
		.toLowerCase()
		.replace(/[‘’‛′]/g, "'")
		.replace(/[^a-z' ]+/g, ' ')
		.trim()
		.replace(/\s+/g, ' ');
}

export function mnemonicWords(phrase: string): string[] {
	const n = normalizeMnemonic(phrase);
	return n === '' ? [] : n.split(' ');
}

/**
 * Pick which word positions to ask for, without repeats. `draw(n)` must return
 * an integer in [0, n) and is injected so the caller supplies real randomness
 * and the tests supply a fixed sequence.
 *
 * Positions are returned ascending: asking for word 9, then 2, then 7 makes a
 * scared person hunt up and down a list they just wrote by hand.
 */
export function pickConfirmPositions(
	total: number,
	want: number,
	draw: (exclusiveMax: number) => number
): number[] {
	const n = Math.min(Math.max(want, 0), Math.max(total, 0));
	const pool = Array.from({ length: total }, (_, i) => i);
	const picked: number[] = [];
	for (let i = 0; i < n; i++) {
		const j = draw(pool.length);
		picked.push(pool[j] ?? 0);
		pool.splice(j, 1);
	}
	return picked.sort((a, b) => a - b);
}

/**
 * Check the words the user re-typed. Case and spacing are forgiven; the word
 * itself is not. Not constant-time on purpose: the user is checking their own
 * phrase against their own paper, so there is no secret to leak to them, and
 * every position must be right.
 */
export function checkConfirmAnswers(
	words: readonly string[],
	positions: readonly number[],
	answers: readonly string[]
): boolean {
	if (positions.length === 0) return false;
	if (answers.length !== positions.length) return false;
	return positions.every((pos, i) => {
		const expected = words[pos];
		const given = answers[i];
		if (expected === undefined || given === undefined) return false;
		return normalizeMnemonic(given) === expected;
	});
}

/**
 * A short, human-comparable form of a public key: the first 8 bytes, grouped.
 * Shown so someone can eyeball that two devices ended up with the same identity
 * after a restore. It is not a security check and is never used as one.
 */
export function fingerprint(publicKey: Uint8Array): string {
	const hex = Array.from(publicKey.slice(0, 8), (b) => b.toString(16).padStart(2, '0'))
		.join('')
		.toUpperCase();
	return (hex.match(/.{1,4}/g) ?? []).join(' ');
}

/**
 * Whether the words are still on this phone, and whether that is the user's
 * choice or just the not-yet-written-down window.
 *
 * - `pending`   created, not yet confirmed. The words are held so they can be
 *               shown. This is a real exposure window and the copy says so.
 * - `kept`      confirmed, and the user opted to keep the words here.
 * - `erased`    confirmed, words gone. The safe resting state.
 */
export type BackupState = 'pending' | 'kept' | 'erased';

export function wordsAreOnDevice(state: BackupState): boolean {
	return state !== 'erased';
}

/**
 * Turning "keep the words on this phone" back ON is only possible while the
 * words still exist. Once erased they are unrecoverable by design, and the UI
 * has to say that rather than offering a switch that silently does nothing.
 */
export function canEnableKeepWords(state: BackupState): boolean {
	return state === 'pending' || state === 'kept';
}
