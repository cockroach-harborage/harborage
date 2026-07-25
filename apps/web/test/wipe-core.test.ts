/**
 * The device-erase scope, as a fact rather than an `if` in a component.
 *
 * ARCHITECTURE §19:1308 says the erase clears IndexedDB, which would include the
 * account. identity.ts says the wipes are deliberately separate. The resolution
 * is that the account goes only when asked, and these tests are what stops a
 * later refactor quietly widening it.
 */
import { describe, expect, it } from 'vitest';
import { databasesToDelete, IDENTITY_DB, wipeWarningKeys } from '../src/lib/wipe-core.ts';

describe('what a device erase destroys', () => {
	it('leaves the account database alone by default', () => {
		expect(databasesToDelete({ identity: false })).not.toContain(IDENTITY_DB);
	});

	it('removes the account database only when asked', () => {
		expect(databasesToDelete({ identity: true })).toContain(IDENTITY_DB);
	});

	it('always removes the documents and the queue', () => {
		for (const identity of [true, false]) {
			const dbs = databasesToDelete({ identity });
			expect(dbs).toContain('harborage-records');
			expect(dbs).toContain('harborage-outbox');
		}
	});

	it('names no database twice, so a delete is never attempted twice', () => {
		const dbs = databasesToDelete({ identity: true });
		expect(new Set(dbs).size).toBe(dbs.length);
	});
});

describe('what the confirm step must say', () => {
	it('always warns that a not-yet-vaulted original is destroyed', () => {
		expect(wipeWarningKeys({ identity: false, wordsOnDevice: false })).toContain('wipe_4');
	});

	it('says nothing about the account when the account is being kept', () => {
		const keys = wipeWarningKeys({ identity: false, wordsOnDevice: true });
		expect(keys).not.toContain('wipe_also_account_hint');
		expect(keys).not.toContain('wipe_words_here');
	});

	it('warns about the backup words only when they are saved here', () => {
		expect(wipeWarningKeys({ identity: true, wordsOnDevice: true })).toContain('wipe_words_here');
		expect(wipeWarningKeys({ identity: true, wordsOnDevice: false })).not.toContain(
			'wipe_words_here'
		);
	});

	it('warns that only the backup words bring the account back', () => {
		expect(wipeWarningKeys({ identity: true, wordsOnDevice: false })).toContain(
			'wipe_also_account_hint'
		);
	});
});
