import { describe, expect, it } from 'vitest';
import {
	ACTIVE_COMPARTMENTS,
	CACHED_COMPARTMENTS,
	ONE_SHOT_ONLY_COMPARTMENTS,
	COMPARTMENTS,
	compartmentFromOrdinal,
	compartmentOrdinal,
	domainSeparate,
	FIRST_EPOCH,
	isCompartment,
	isValidEpoch,
	MAX_EPOCH,
	nextEpoch,
	SIG_CONTEXT
} from '../src/compartments.ts';

const enc = new TextEncoder();

describe('compartment enum', () => {
	// This is the load-bearing test in this file. The ordinal is a wire value:
	// reordering the list silently repoints every already-issued cap-cert at a
	// different compartment, which is a confused-deputy bug, not a refactor.
	it('pins every ordinal (append-only; never reorder or reuse)', () => {
		expect([...COMPARTMENTS]).toEqual([
			'document',
			'directory',
			'community',
			'accountability',
			'curation',
			'medical',
			'aid',
			'legal'
		]);
		expect(compartmentOrdinal('document')).toBe(0);
		expect(compartmentOrdinal('legal')).toBe(7);
	});

	it('has no duplicate names', () => {
		expect(new Set(COMPARTMENTS).size).toBe(COMPARTMENTS.length);
	});

	it('round-trips name to ordinal and back', () => {
		for (const c of COMPARTMENTS) {
			expect(compartmentFromOrdinal(compartmentOrdinal(c))).toBe(c);
		}
	});

	// A wire ordinal is untrusted input. Out of range must be null, never a throw
	// and never a silent clamp onto a real compartment.
	it('rejects an out-of-range or non-integer ordinal', () => {
		expect(compartmentFromOrdinal(-1)).toBeNull();
		expect(compartmentFromOrdinal(COMPARTMENTS.length)).toBeNull();
		expect(compartmentFromOrdinal(255)).toBeNull();
		expect(compartmentFromOrdinal(1.5)).toBeNull();
		expect(compartmentFromOrdinal(Number.NaN)).toBeNull();
	});

	it('narrows a string safely', () => {
		expect(isCompartment('document')).toBe(true);
		expect(isCompartment('Document')).toBe(false);
		expect(isCompartment('constructor')).toBe(false);
		expect(isCompartment('')).toBe(false);
	});

	it('accepts the four M4 compartments and no more', () => {
		expect([...ACTIVE_COMPARTMENTS]).toEqual(['document', 'directory', 'medical', 'aid']);
		for (const c of ACTIVE_COMPARTMENTS) expect(isCompartment(c)).toBe(true);
	});

	/**
	 * The three lists answer three different questions and conflating any two of
	 * them is a real seizure exposure, not a tidiness issue. ACTIVE is what the
	 * server accepts a certificate for; CACHED is what a device stores a key for;
	 * ONE_SHOT_ONLY is what may only ever be reached through a per-request key.
	 *
	 * M4 nearly shipped with one combined list, which would have installed a
	 * durable medical key into IndexedDB on every device at account creation,
	 * including the overwhelming majority that never touch the broker.
	 */
	it('keeps cached and one-shot compartments disjoint, and both inside active', () => {
		expect([...CACHED_COMPARTMENTS]).toEqual(['document', 'directory']);
		expect([...ONE_SHOT_ONLY_COMPARTMENTS]).toEqual(['medical', 'aid']);

		for (const c of CACHED_COMPARTMENTS) expect(ACTIVE_COMPARTMENTS).toContain(c);
		for (const c of ONE_SHOT_ONLY_COMPARTMENTS) expect(ACTIVE_COMPARTMENTS).toContain(c);

		// Disjoint. A compartment in both lists would be stored on the device AND
		// nominally one-shot, which is the worst of both: a durable key plus a
		// claim that there is not one.
		for (const c of CACHED_COMPARTMENTS) expect(ONE_SHOT_ONLY_COMPARTMENTS).not.toContain(c);

		// Together they cover ACTIVE exactly. An active compartment in neither
		// list has no defined key custody at all.
		expect([...CACHED_COMPARTMENTS, ...ONE_SHOT_ONLY_COMPARTMENTS].sort()).toEqual(
			[...ACTIVE_COMPARTMENTS].sort()
		);
	});

	/** Ordinals go on the wire (cap-cert byte 6). Widening the active set must not move them. */
	it('leaves the wire ordinals where they were', () => {
		expect(compartmentOrdinal('medical')).toBe(5);
		expect(compartmentOrdinal('aid')).toBe(6);
		expect(compartmentOrdinal('document')).toBe(0);
		expect(compartmentOrdinal('legal')).toBe(7);
	});
});

describe('device-local epoch', () => {
	it('accepts only integers in range', () => {
		expect(isValidEpoch(FIRST_EPOCH)).toBe(true);
		expect(isValidEpoch(MAX_EPOCH)).toBe(true);
		expect(isValidEpoch(0)).toBe(false);
		expect(isValidEpoch(-1)).toBe(false);
		expect(isValidEpoch(1.5)).toBe(false);
		expect(isValidEpoch(MAX_EPOCH + 1)).toBe(false);
		expect(isValidEpoch('1')).toBe(false);
		expect(isValidEpoch(Number.NaN)).toBe(false);
	});

	it('increments monotonically and refuses to wrap at the ceiling', () => {
		expect(nextEpoch(1)).toBe(2);
		expect(nextEpoch(MAX_EPOCH - 1)).toBe(MAX_EPOCH);
		// Wrapping would re-derive an earlier key, which is the one thing a
		// "start fresh" action must never do.
		expect(nextEpoch(MAX_EPOCH)).toBeNull();
		expect(nextEpoch(0)).toBeNull();
	});
});

describe('signing contexts', () => {
	const values = Object.values(SIG_CONTEXT);

	it('are unique, prefixed and versioned', () => {
		expect(new Set(values).size).toBe(values.length);
		for (const v of values) {
			expect(v.startsWith('harborage/sig/')).toBe(true);
			expect(/\/v\d+$/.test(v)).toBe(true);
		}
	});

	it('frames length-first so the tag set is prefix-free', () => {
		const out = domainSeparate(SIG_CONTEXT.pop, enc.encode('body'));
		const tag = enc.encode(SIG_CONTEXT.pop);
		expect(out[0]).toBe(tag.length);
		expect(out.slice(1, 1 + tag.length)).toEqual(tag);
		expect(out.slice(1 + tag.length)).toEqual(enc.encode('body'));
	});

	// Without the length byte, context "a" over message "b/c" and context "a/b"
	// over message "c" would produce identical signed bytes. This asserts they
	// do not, using the real contexts where one is not a prefix of another, and
	// a constructed pair where it is.
	it('cannot be confused by splitting the boundary', () => {
		const a = domainSeparate('harborage/sig/pop/v1' as never, enc.encode('X'));
		const b = domainSeparate('harborage/sig/pop/v1X' as never, new Uint8Array());
		expect(a).not.toEqual(b);
	});

	it('rejects an empty or oversize context', () => {
		expect(() => domainSeparate('' as never, new Uint8Array())).toThrow();
		expect(() => domainSeparate('x'.repeat(256) as never, new Uint8Array())).toThrow();
	});

	it('handles an empty message', () => {
		const out = domainSeparate(SIG_CONTEXT.capCert, new Uint8Array());
		expect(out.length).toBe(1 + enc.encode(SIG_CONTEXT.capCert).length);
	});
});
