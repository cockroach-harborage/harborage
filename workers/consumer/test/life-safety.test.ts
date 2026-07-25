import { describe, expect, it } from 'vitest';
import {
	dispositionFor,
	isLifeSafetyEvent,
	LIFE_SAFETY_KINDS,
	LIFE_SAFETY_LANES
} from '../src/life-safety.ts';

const VALID = { kind: 'broker_saturated', lane: 'medical', band: 'SOME', bucket: '2026-07-26' };

describe('the life-safety payload shape', () => {
	it('accepts a well-formed event', () => {
		expect(isLifeSafetyEvent(VALID)).toBe(true);
		expect(dispositionFor(VALID)).toBe('ack');
	});

	/**
	 * EXACT SHAPE, NOT A SUPERSET. An extra key is a field somebody added without
	 * deciding whether it is safe to retain for days in a dead-letter queue, and
	 * silently ignoring it is how a region, a note or a handle arrives here.
	 *
	 * `region` is called out by name because it is the one somebody will add:
	 * "medical broker saturated in IN-PB-LDH" is exactly the operational detail an
	 * operator would want, and exactly the protest-intensity-tied-to-a-place
	 * signal this platform does not hold.
	 */
	it('refuses a superset, including the region somebody will want to add', () => {
		for (const extra of [
			{ region: 'IN-PB-LDH' },
			{ region_bucket: 'IN-DL' },
			{ note: 'three people waiting' },
			{ envelope: 'AAAA' },
			{ count: 3 }
		]) {
			const body = { ...VALID, ...extra };
			expect(isLifeSafetyEvent(body), JSON.stringify(extra)).toBe(false);
			expect(dispositionFor(body)).toBe('retry');
		}
	});

	it('refuses a missing key', () => {
		for (const key of Object.keys(VALID)) {
			const body: Record<string, unknown> = { ...VALID };
			delete body[key];
			expect(isLifeSafetyEvent(body), key).toBe(false);
		}
	});

	it('refuses an unknown kind, lane or band', () => {
		expect(isLifeSafetyEvent({ ...VALID, kind: 'something_else' })).toBe(false);
		expect(isLifeSafetyEvent({ ...VALID, lane: 'directory' })).toBe(false);
		expect(isLifeSafetyEvent({ ...VALID, band: 'FOUR' })).toBe(false);
	});

	/** A band, never a count. Same argument as capacity_bands. */
	it('refuses a numeric band', () => {
		expect(isLifeSafetyEvent({ ...VALID, band: 3 })).toBe(false);
		expect(isLifeSafetyEvent({ ...VALID, band: '3' })).toBe(false);
	});

	/** A coarse day bucket, never a precise instant. */
	it('refuses a timestamp where a day bucket belongs', () => {
		expect(isLifeSafetyEvent({ ...VALID, bucket: '2026-07-26T14:23:11Z' })).toBe(false);
		expect(isLifeSafetyEvent({ ...VALID, bucket: 1785000000000 })).toBe(false);
	});

	/**
	 * Anything unrecognised RETRIES so it reaches the DLQ. A silent ack on a
	 * malformed life-safety message is the one outcome with no trace at all, and
	 * this lane deliberately writes nothing to D1.
	 */
	it('retries rather than acking anything it does not understand', () => {
		for (const junk of [null, undefined, 'text', 42, [], {}]) {
			expect(dispositionFor(junk)).toBe('retry');
		}
	});

	it('names a lane and a failure mode, never a person or a place', () => {
		for (const k of LIFE_SAFETY_KINDS) expect(k).not.toMatch(/user|person|ip|region|district|geo/);
		for (const l of LIFE_SAFETY_LANES) expect(l).not.toMatch(/IN-|[A-Z]{2}-/);
	});
});
