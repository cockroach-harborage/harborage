/**
 * The confidentiality properties of the brokered lane, tested where they are
 * decidable.
 *
 * NONE OF THIS IS VISIBLE FROM A ROUTE TEST. Every /api/aid/* route returns a
 * flat 403 with the flag off, a flat 401 without a credential, and a flat 403
 * for a bad token. A route-level test asserting "no helper card came back"
 * passes with the padding, the token MAC and the frame checks all deleted. So
 * they are tested here, against the pure module, directly.
 */
import { describe, expect, it } from 'vitest';
import {
	AID_CATEGORIES,
	BROKER_FRAME_LEN,
	brokerName,
	brokerRef,
	buildBrokerFrame,
	handleRefOf,
	mintInboxToken,
	padPollResponse,
	parseBrokerFrame,
	tickOf,
	TICK_MS,
	verifyInboxToken
} from '../src/broker.ts';

const MAC = 'test-broker-mac-key-not-a-real-one';
const SEALED = new Uint8Array(3000).fill(9);

function randomBytes(n: number): Uint8Array {
	const b = new Uint8Array(n);
	crypto.getRandomValues(b);
	return b;
}

describe('padPollResponse', () => {
	/**
	 * THE CLAIM: an empty poll and a delivering poll are the same size on the
	 * wire. Delete the padding and this goes red.
	 */
	it('returns exactly one length whether or not there is a message', () => {
		const frame = buildBrokerFrame({ region: 'IN-DL', category: 'food', sealed: SEALED });
		const empty = padPollResponse(null, randomBytes(BROKER_FRAME_LEN));
		const full = padPollResponse(frame, randomBytes(BROKER_FRAME_LEN));
		expect(empty.length).toBe(BROKER_FRAME_LEN);
		expect(full.length).toBe(BROKER_FRAME_LEN);
		expect(empty.length).toBe(full.length);
	});

	/**
	 * Zero-fill would be a compression oracle the moment anything downstream
	 * gzips, and an all-zero body is trivially distinguishable from ciphertext
	 * even without compression.
	 */
	it('fills an empty response with random bytes, not zeros', () => {
		const empty = padPollResponse(null, randomBytes(BROKER_FRAME_LEN));
		expect(empty.some((b) => b !== 0)).toBe(true);
		expect(new Set(empty).size).toBeGreaterThan(100);
	});

	it('carries no status byte that would distinguish the two', () => {
		const frame = buildBrokerFrame({ region: 'IN-DL', category: 'food', sealed: SEALED });
		const full = padPollResponse(frame, randomBytes(BROKER_FRAME_LEN));
		// The response begins with the frame itself, not with a marker.
		expect(full[0]).toBe(0x48); // "H" of HBE1
	});
});

describe('inbox tokens', () => {
	/**
	 * THE RESTING STATE. No key means nothing verifies, so every brokered route
	 * refuses for everyone. Same shape as ONION_INGRESS_MAC_KEY and
	 * PINNED_CUSTODIAN_KEYS: the feature is structurally dark until an operator
	 * exists, rather than dark by a flag someone can flip early.
	 */
	it('refuses everything when no key is configured', async () => {
		const ref = await brokerRef(MAC, 'IN-DL', 'food');
		const token = await mintInboxToken(MAC, ref!, randomBytes(16), 0);
		expect(await verifyInboxToken(undefined, token!)).toBeNull();
		expect(await mintInboxToken(undefined, ref!, randomBytes(16), 0)).toBeNull();
		expect(await brokerRef(undefined, 'IN-DL', 'food')).toBeNull();
	});

	it('round-trips the broker reference, handle and slot', async () => {
		const ref = await brokerRef(MAC, 'IN-PB-LDH', 'legal_intake');
		const handle = randomBytes(16);
		const token = await mintInboxToken(MAC, ref!, handle, 3);
		const opened = await verifyInboxToken(MAC, token!);
		expect(opened).not.toBeNull();
		expect(Array.from(opened!.brokerRef)).toEqual(Array.from(ref!));
		expect(Array.from(opened!.handle)).toEqual(Array.from(handle));
		expect(opened!.slot).toBe(3);
	});

	/**
	 * THE AMPLIFICATION GUARD, one layer up from admitOneShot. A forged token
	 * must be refused BEFORE any Durable Object is addressed, so inventing
	 * handles cannot mint instances.
	 */
	it('refuses a token with a tampered tag', async () => {
		const ref = await brokerRef(MAC, 'IN-DL', 'food');
		const token = await mintInboxToken(MAC, ref!, randomBytes(16), 0);
		const bytes = Uint8Array.from(atob(token!.replaceAll('-', '+').replaceAll('_', '/')), (c) =>
			c.charCodeAt(0)
		);
		bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff;
		const tampered = btoa(String.fromCharCode(...bytes))
			.replaceAll('+', '-')
			.replaceAll('/', '_')
			.replace(/=+$/, '');
		expect(await verifyInboxToken(MAC, tampered)).toBeNull();
	});

	/** The broker reference is inside the MAC, so a token cannot be re-aimed. */
	it('refuses a token whose broker reference was swapped', async () => {
		const a = await brokerRef(MAC, 'IN-DL', 'food');
		const b = await brokerRef(MAC, 'IN-KA', 'food');
		const handle = randomBytes(16);
		const token = await mintInboxToken(MAC, a!, handle, 0);
		const bytes = Uint8Array.from(atob(token!.replaceAll('-', '+').replaceAll('_', '/')), (c) =>
			c.charCodeAt(0)
		);
		bytes.set(b!, 1);
		const swapped = btoa(String.fromCharCode(...bytes))
			.replaceAll('+', '-')
			.replaceAll('/', '_')
			.replace(/=+$/, '');
		expect(await verifyInboxToken(MAC, swapped)).toBeNull();
	});

	it('refuses junk, truncation and the wrong version', async () => {
		expect(await verifyInboxToken(MAC, 'not base64 !!')).toBeNull();
		expect(await verifyInboxToken(MAC, '')).toBeNull();
		expect(await verifyInboxToken(MAC, 'AAAA')).toBeNull();
	});

	/** A different key must not verify. Otherwise the MAC is decorative. */
	it('refuses a token minted under a different key', async () => {
		const ref = await brokerRef(MAC, 'IN-DL', 'food');
		const token = await mintInboxToken(MAC, ref!, randomBytes(16), 0);
		expect(await verifyInboxToken('a-different-mac-key-entirely', token!)).toBeNull();
	});
});

describe('brokerRef', () => {
	/**
	 * The instance name must not spell out which district's legal-intake queue
	 * is busy. A Durable Object name is not content, but it is an identifier that
	 * appears in platform-side plumbing.
	 */
	it('produces an opaque name that contains neither region nor category', async () => {
		const ref = await brokerRef(MAC, 'IN-PB-LDH', 'legal_intake');
		const name = brokerName(ref!);
		expect(name).toMatch(/^b:[0-9a-f]{8}$/);
		expect(name).not.toContain('IN');
		expect(name).not.toContain('legal');
	});

	it('separates region and category', async () => {
		const a = brokerName((await brokerRef(MAC, 'IN-DL', 'food'))!);
		const b = brokerName((await brokerRef(MAC, 'IN-DL', 'water'))!);
		const c = brokerName((await brokerRef(MAC, 'IN-KA', 'food'))!);
		expect(new Set([a, b, c]).size).toBe(3);
	});

	it('refuses a region that is not a signed-looking code', async () => {
		expect(await brokerRef(MAC, 'somewhere', 'food')).toBeNull();
		expect(await brokerRef(MAC, '', 'food')).toBeNull();
	});
});

describe('parseBrokerFrame', () => {
	/**
	 * A short frame is not merely malformed. Accepting one would reintroduce the
	 * size channel the whole lane exists to close, so the length check is exact
	 * rather than a floor.
	 */
	it('refuses any length other than exactly one frame', () => {
		const frame = buildBrokerFrame({ region: 'IN-DL', category: 'food', sealed: SEALED });
		expect(parseBrokerFrame(frame)).not.toBeNull();
		expect(parseBrokerFrame(frame.subarray(0, BROKER_FRAME_LEN - 1))).toBeNull();
		const longer = new Uint8Array(BROKER_FRAME_LEN + 1);
		longer.set(frame);
		expect(parseBrokerFrame(longer)).toBeNull();
	});

	it('round-trips the routing fields and the commitment', () => {
		const commit = randomBytes(32);
		const handleRef = handleRefOf(new Uint8Array(4).fill(7), new Uint8Array(16).fill(3));
		const frame = buildBrokerFrame({
			region: 'IN-PB-LDH',
			category: 'shelter_org',
			commit,
			handleRef,
			sealed: SEALED
		});
		const parsed = parseBrokerFrame(frame);
		expect(parsed).not.toBeNull();
		expect(parsed!.region).toBe('IN-PB-LDH');
		expect(parsed!.category).toBe('shelter_org');
		expect(Array.from(parsed!.commit)).toEqual(Array.from(commit));
		expect(Array.from(parsed!.handleRef)).toEqual(Array.from(handleRef));
	});

	it('refuses an unknown category ordinal', () => {
		const frame = buildBrokerFrame({ region: 'IN-DL', category: 'food', sealed: SEALED });
		frame[5 + 1 + 12] = 200;
		expect(parseBrokerFrame(frame)).toBeNull();
	});

	it('refuses a region that is not a signed-looking code', () => {
		const frame = buildBrokerFrame({ region: 'IN-DL', category: 'food', sealed: SEALED });
		// Overwrite the region bytes with lowercase junk of the same declared length.
		frame.set(new TextEncoder().encode('abcde'), 6);
		expect(parseBrokerFrame(frame)).toBeNull();
	});

	/**
	 * The interlock from PRD §4.8, kept by vocabulary rather than by a check:
	 * short-term housing is brokered only through an organisation with premises,
	 * and there is no word here for stranger-to-home.
	 */
	it('has no category that could express stranger-to-home accommodation', () => {
		for (const c of AID_CATEGORIES) {
			expect(c).not.toMatch(/home|host|room|couch|spare|private_stay/);
		}
		expect(AID_CATEGORIES).toContain('shelter_org');
	});
});

describe('tickOf', () => {
	it('advances once per tick', () => {
		expect(tickOf(0, 0)).toBe(0);
		expect(tickOf(TICK_MS - 1, 0)).toBe(0);
		expect(tickOf(TICK_MS, 0)).toBe(1);
	});

	it('is shifted by the per-instance offset, so brokers do not run in lockstep', () => {
		expect(tickOf(TICK_MS - 1, 0)).not.toBe(tickOf(TICK_MS - 1, 1));
	});
});
