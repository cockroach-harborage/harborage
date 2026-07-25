import { describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { base64 } from '@scure/base';
import { domainSeparate, SIG_CONTEXT } from '@harborage/crypto/compartments';
import type { KeyDirectoryEntry, RevocationEntry } from '@harborage/crypto/notice';
import {
	isZoneId,
	verifyZoneList,
	zoneListHash,
	type SignedZoneList,
	type ZoneEntry
} from '../src/liveboard/zone.ts';

const EPOCH = 4;

function keypair(seed: number) {
	const priv = new Uint8Array(32).fill(seed);
	return { priv, pub: base64.encode(ed25519.getPublicKey(priv)) };
}

function entry(id: string, seed: number, role = 'zone_publisher'): KeyDirectoryEntry {
	return {
		key_id: id,
		public_key: keypair(seed).pub,
		role,
		valid_from_epoch: 1,
		valid_to_epoch: null
	};
}

const ZONES: ZoneEntry[] = [
	{ zone_id: 'IN-DL-z0417', region_bucket: 'IN-DL', label_key: 'zone.delhi.north.gate' },
	{ zone_id: 'IN-PB-LDH-z0002', region_bucket: 'IN-PB-LDH', label_key: 'zone.ludhiana.clock.tower' }
];

const DIRECTORY = [entry('p1', 21), entry('p2', 22), entry('p3', 23)];

async function signedList(over: Partial<SignedZoneList> = {}): Promise<SignedZoneList> {
	const epoch = over.list_epoch ?? EPOCH;
	const zones = over.zones ?? ZONES;
	const hash = await zoneListHash(epoch, zones);
	const framed = domainSeparate(SIG_CONTEXT.zoneList, hash);
	return {
		list_epoch: epoch,
		zones,
		signatures:
			over.signatures ??
			[21, 22].map((seed, i) => ({
				key_id: `p${i + 1}`,
				sig: base64.encode(ed25519.sign(framed, keypair(seed).priv))
			}))
	};
}

function policy(over: Partial<Parameters<typeof verifyZoneList>[1]> = {}) {
	return {
		directory: DIRECTORY,
		revocations: [] as RevocationEntry[],
		required: 2,
		minDistinctKeys: 3,
		minEpoch: 1,
		...over
	};
}

describe('a zone id carries no position', () => {
	it('accepts an opaque region-plus-ordinal id', () => {
		expect(isZoneId('IN-DL-z0417')).toBe(true);
		expect(isZoneId('IN-PB-LDH-z0002')).toBe(true);
	});

	/**
	 * A geohash in the id would serve no client purpose: sorting by proximity needs
	 * the client to know its own position, and there is no self-location primitive
	 * on this platform. So the geohash would be a coordinate the schema carries for
	 * nobody, and coordinates carried for nobody are coordinates a later query uses.
	 */
	it('refuses an id that looks like a geohash cell', () => {
		expect(isZoneId('IN-DL-tuvz9k')).toBe(false);
		expect(isZoneId('tuvz9k')).toBe(false);
		expect(isZoneId('IN-DL-28.61-77.20')).toBe(false);
	});

	it('refuses free-form ids, which would be a free-form instance namespace', () => {
		for (const bad of ['', 'somewhere', 'IN-DL', 'IN-DL-z417', '../../etc', 'IN-DL-z0417x']) {
			expect(isZoneId(bad), bad).toBe(false);
		}
	});
});

describe('verifyZoneList', () => {
	it('accepts a list signed by a quorum', async () => {
		const v = await verifyZoneList(await signedList(), policy());
		expect(v.valid).toBe(true);
		expect(v.zones).toHaveLength(2);
	});

	/**
	 * ALL OR NOTHING. A half-accepted list is a list whose contents an attacker
	 * chose, so a failure yields no zones at all rather than the subset that
	 * happened to parse.
	 */
	it('yields no zones at all on any failure', async () => {
		const unsigned = await signedList({ signatures: [] });
		const v = await verifyZoneList(unsigned, policy());
		expect(v.valid).toBe(false);
		expect(v.zones).toEqual([]);
	});

	/**
	 * THE ROLLBACK FLOOR, and it is the half a signature check alone does not
	 * give: an old list is PERFECTLY SIGNED, so without this a compelled edge
	 * could serve last week's list to re-enable a zone that was withdrawn.
	 */
	it('refuses a correctly-signed list from an earlier epoch', async () => {
		const old = await signedList({ list_epoch: 2 });
		// It really is valid, just old: the same list passes with a lower floor.
		expect((await verifyZoneList(old, policy({ minEpoch: 1 }))).valid).toBe(true);
		expect((await verifyZoneList(old, policy({ minEpoch: 3 }))).valid).toBe(false);
	});

	it('refuses a list whose zones were altered after signing', async () => {
		const list = await signedList();
		list.zones = [...ZONES, { zone_id: 'IN-DL-z9999', region_bucket: 'IN-DL', label_key: 'x' }];
		expect((await verifyZoneList(list, policy())).valid).toBe(false);
	});

	it('refuses a malformed zone id before checking any signature', async () => {
		const list = await signedList({
			zones: [{ zone_id: 'IN-DL-tuvz9k', region_bucket: 'IN-DL', label_key: 'x' }]
		});
		const v = await verifyZoneList(list, policy());
		expect(v.valid).toBe(false);
		expect(v.reason).toMatch(/malformed/);
	});

	it('refuses a duplicate zone id', async () => {
		const list = await signedList({ zones: [ZONES[0]!, ZONES[0]!] });
		const v = await verifyZoneList(list, policy());
		expect(v.valid).toBe(false);
		expect(v.reason).toMatch(/duplicate/);
	});

	it('refuses when the publisher directory is too small', async () => {
		const v = await verifyZoneList(
			await signedList(),
			policy({ directory: [entry('p1', 21), entry('p2', 22)] })
		);
		expect(v.valid).toBe(false);
	});

	/**
	 * THE RESTING STATE. The directory ships empty and live_zones has zero rows, so
	 * no list verifies and every ingest refuses. This is what the production
	 * posture actually is, and it deserves a test rather than a comment.
	 */
	it('refuses every list while the publisher directory is empty', async () => {
		expect((await verifyZoneList(await signedList(), policy({ directory: [] }))).valid).toBe(false);
	});
});

describe('zoneListHash', () => {
	it('is order-independent, so two publishers agree', async () => {
		const a = await zoneListHash(EPOCH, ZONES);
		const b = await zoneListHash(EPOCH, [...ZONES].reverse());
		expect(Array.from(a)).toEqual(Array.from(b));
	});

	it('changes with the epoch and with the membership', async () => {
		const base = await zoneListHash(EPOCH, ZONES);
		expect(Array.from(await zoneListHash(EPOCH + 1, ZONES))).not.toEqual(Array.from(base));
		expect(Array.from(await zoneListHash(EPOCH, [ZONES[0]!]))).not.toEqual(Array.from(base));
	});
});

describe('there is no coordinate-to-zone function', () => {
	/**
	 * The structural claim. If no such function exists, no client can be tricked
	 * into computing one and no compelled Worker can be asked to. Asserted over
	 * the module's exports rather than left to review.
	 */
	it('exports nothing that maps a position to a zone', async () => {
		const mod = await import('../src/liveboard/zone.ts');
		for (const name of Object.keys(mod)) {
			expect(name).not.toMatch(/latLng|fromCoord|nearest|locate|geohashTo|positionTo/i);
		}
	});
});
