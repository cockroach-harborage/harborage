/**
 * Account identity = BIP39 mnemonic (English wordlist) → seed (§5.1).
 * No server, no PII, no reset path — "lose it = lose the account" is the
 * security property, stated verbatim in-product.
 *
 * The optional passphrase (25th word) selects a different tree (duress/decoy,
 * §5.2). Best-effort only in a browser: no hidden-volume guarantee, and
 * coercive unlock defeats it. Never oversell this before the APK.
 */
import { generateMnemonic, mnemonicToSeed, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

export function newMnemonic(): string {
	return generateMnemonic(wordlist, 128);
}

export function isValidMnemonic(mnemonic: string): boolean {
	return validateMnemonic(mnemonic, wordlist);
}

/** Passphrase "" is the primary tree; any other passphrase derives a decoy tree. */
export async function mnemonicToRootSeed(
	mnemonic: string,
	passphrase = ''
): Promise<Uint8Array> {
	if (!isValidMnemonic(mnemonic)) throw new Error('invalid mnemonic');
	return mnemonicToSeed(mnemonic, passphrase);
}
