/**
 * What a device erase destroys (ARCHITECTURE §19:1308).
 *
 * Pure and tiny on purpose: it turns the identity-scope decision into a fact a
 * test can break, rather than an `if` inside a component that nobody re-reads.
 * Imports nothing, so apps/web's DOM-less vitest config can run it.
 *
 * THE SCOPE DECISION. §19:1308 says the wipe clears IndexedDB, and
 * harborage-identity is IndexedDB. identity.ts says the wipes are deliberately
 * separate, because "one button that silently destroys everything is how people
 * lose evidence they meant to keep". Both are right about different people: the
 * document wipe protects the people IN the photographs and has to work in one
 * tap at a checkpoint; the identity wipe protects the user's own pseudonymity
 * and is irreversible in a way the document wipe is not, because backup words
 * are erased by default after confirmation.
 *
 * So the account goes only when asked. The document erase is the primary action;
 * removing the account is an unchecked box on the confirm step. Safety-
 * consequential actions confirm toward the safer choice, and here the safer
 * choice is the NARROWER destruction, because only the wider one is
 * unrecoverable by design.
 */

export interface WipeScope {
	identity: boolean;
}

/** Databases holding documents and pending sends. Always destroyed. */
export const DOCUMENT_DBS = ['harborage-records', 'harborage-outbox'] as const;

/** Keys, epochs, and the pinned intake key. Destroyed only on request. */
export const IDENTITY_DB = 'harborage-identity';

export function databasesToDelete(scope: WipeScope): string[] {
	const dbs: string[] = [...DOCUMENT_DBS];
	if (scope.identity) dbs.push(IDENTITY_DB);
	return dbs;
}

/**
 * Which warnings the confirm step must show. Returned as message keys so the
 * copy stays in the message files and the decision stays testable.
 */
export function wipeWarningKeys(scope: WipeScope & { wordsOnDevice: boolean }): string[] {
	const keys = ['wipe_1', 'wipe_2', 'wipe_3', 'wipe_4', 'wipe_5'];
	if (scope.identity) {
		keys.push('wipe_also_account_hint');
		// The words are on this phone, so the one thing that could restore the
		// account goes with it. Saying so is the difference between a warned
		// choice and a discovered one.
		if (scope.wordsOnDevice) keys.push('wipe_words_here');
	}
	return keys;
}
