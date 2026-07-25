/**
 * Fail-closed admission (ARCHITECTURE §16).
 *
 * The shape of these tests is deliberate: one case per condition REMOVED, so a
 * refactor that drops a check fails a test named after that check rather than
 * failing nothing. Testing only the happy path and one blanket failure is how
 * a missing condition survives.
 */
import { describe, expect, it } from 'vitest';
import {
	ADMISSIBLE_STATES,
	admissionFor,
	MASTER_SATISFIED,
	type AdmissionInput
} from '../src/archive/admission.ts';

const ADMISSIBLE: AdmissionInput = {
	verificationState: 'Human-Verified',
	redactionConfirmed: true,
	radioactiveClear: true,
	derivativeSha256: 'd'.repeat(64),
	masterState: 'built',
	archivePublishEnabled: true
};

describe('what reaches the public archive', () => {
	it('admits an item meeting every condition', () => {
		const d = admissionFor(ADMISSIBLE);
		expect(d.admission).toBe('ADMITTED');
		expect(d.reasons).toEqual([]);
	});

	it('defaults to sealed-only when nothing is asserted', () => {
		const d = admissionFor({
			verificationState: 'Unverified',
			redactionConfirmed: false,
			radioactiveClear: false,
			derivativeSha256: null,
			masterState: 'none',
			archivePublishEnabled: false
		});
		expect(d.admission).toBe('SEALED_ONLY');
	});

	describe('refuses admission with each single condition removed', () => {
		const removals: [string, Partial<AdmissionInput>, string][] = [
			['verification', { verificationState: 'Unverified' }, 'not_verified'],
			['a screened-but-unverified item', { verificationState: 'AI-Screened' }, 'not_verified'],
			['a disputed item', { verificationState: 'Disputed' }, 'not_verified'],
			['the human redaction confirm', { redactionConfirmed: false }, 'redaction_unconfirmed'],
			['the radioactive screen', { radioactiveClear: false }, 'screen_not_clear'],
			['the public derivative', { derivativeSha256: null }, 'no_public_derivative'],
			['the archive flag', { archivePublishEnabled: false }, 'archive_publish_off']
		];
		for (const [what, patch, reason] of removals) {
			it(`without ${what}`, () => {
				const d = admissionFor({ ...ADMISSIBLE, ...patch });
				expect(d.admission).not.toBe('ADMITTED');
				expect(d.reasons).toContain(reason);
			});
		}
	});

	it('never admits an unverified item, whatever else is true', () => {
		for (const state of ['Unverified', 'AI-Screened', 'Corroborating', 'Disputed', 'Debunked']) {
			expect(admissionFor({ ...ADMISSIBLE, verificationState: state }).admission).not.toBe(
				'ADMITTED'
			);
		}
	});

	it('admits from exactly the two states section 16 allows and no others', () => {
		expect([...ADMISSIBLE_STATES]).toEqual(['Community-Corroborated', 'Human-Verified']);
		for (const state of ADMISSIBLE_STATES) {
			expect(admissionFor({ ...ADMISSIBLE, verificationState: state }).admission).toBe('ADMITTED');
		}
	});

	it('never admits while redaction is unconfirmed', () => {
		// The red line: an unredacted face reaching the permanent public archive
		// is not recoverable by taking the item down later.
		for (const state of ADMISSIBLE_STATES) {
			const d = admissionFor({
				...ADMISSIBLE,
				verificationState: state,
				redactionConfirmed: false
			});
			expect(d.admission).toBe('SEALED_ONLY');
		}
	});

	it('names every failure rather than stopping at the first', () => {
		const d = admissionFor({
			...ADMISSIBLE,
			verificationState: 'Unverified',
			redactionConfirmed: false,
			radioactiveClear: false
		});
		expect(d.reasons).toEqual(
			expect.arrayContaining(['not_verified', 'redaction_unconfirmed', 'screen_not_clear'])
		);
	});
});

describe('the server master', () => {
	it('admits when the master was skipped for size, because the client copy is the artifact', () => {
		// A transform quota must not decide whether evidence is publishable.
		expect([...MASTER_SATISFIED]).toContain('skipped_oversize');
		expect(admissionFor({ ...ADMISSIBLE, masterState: 'skipped_oversize' }).admission).toBe(
			'ADMITTED'
		);
	});

	it('holds an otherwise-ready item at candidate while the master is pending', () => {
		const d = admissionFor({ ...ADMISSIBLE, masterState: 'pending' });
		expect(d.admission).toBe('CANDIDATE');
		expect(d.reasons).toEqual(['master_pending']);
	});

	it('does not treat candidate as a weaker admission', () => {
		// Nothing is published in this state; only ADMITTED is public.
		expect(admissionFor({ ...ADMISSIBLE, masterState: 'failed' }).admission).not.toBe('ADMITTED');
	});

	it('drops to sealed-only when the master is pending and anything else is missing', () => {
		expect(
			admissionFor({ ...ADMISSIBLE, masterState: 'pending', redactionConfirmed: false }).admission
		).toBe('SEALED_ONLY');
	});
});
