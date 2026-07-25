import { describe, expect, it } from 'vitest';
import {
	CEK_LENGTH,
	VaultCustodyError,
	combineTierB,
	decodeKeyring,
	encodeKeyring,
	quorumIsOffshoreBound,
	wrapTierA,
	wrapTierB,
	PINNED_CUSTODIAN_KEYS,
	type HolderKey,
	type Rng
} from '../src/vault-key.ts';
import { openSealedBox, sealedBoxPublicKey } from '../src/sealed-box.ts';

/** Deterministic randomness, so a failure is reproducible rather than a coin flip. */
function seededRng(seed = 1): Rng {
	let s = seed >>> 0;
	return (length: number) => {
		const out = new Uint8Array(length);
		for (let i = 0; i < length; i++) {
			s = (s * 1664525 + 1013904223) >>> 0;
			out[i] = (s >>> 24) & 0xff;
		}
		return out;
	};
}

function holder(name: HolderKey['holder'], secretByte: number) {
	const secretKey = new Uint8Array(32).fill(secretByte);
	return { key: { holder: name, publicKey: sealedBoxPublicKey(secretKey) }, secretKey };
}

const reporter = holder('reporter', 7);
const lawyer = holder('lawyer', 9);
const offshore = holder('custodian-offshore', 11);
const CUSTODIANS = [offshore.key];

const cek = new Uint8Array(CEK_LENGTH).fill(0x5a);
const digest = new Uint8Array(32).fill(0x11);

describe('fail-closed until a custodian exists', () => {
	// The switch-on gate, made structural. No custodian organisation exists yet,
	// so no evidence key can be wrapped under a scheme nobody can honour.
	it('ships with no pinned custodian', () => {
		expect(PINNED_CUSTODIAN_KEYS).toHaveLength(0);
	});

	it('refuses to wrap when no offshore custodian is pinned', () => {
		expect(() => wrapTierA(cek, digest, reporter.key, seededRng())).toThrow(VaultCustodyError);
		expect(wrapTierB(cek, digest, [reporter.key], seededRng())).rejects.toThrow(VaultCustodyError);
	});

	it('refuses a custodian set that is domestic only', () => {
		expect(() => wrapTierA(cek, digest, reporter.key, seededRng(), [lawyer.key])).toThrow(
			/offshore/
		);
	});
});

describe('tier A: reporter plus one off-platform custodian', () => {
	it('produces two independent whole-key copies, both openable by their holder', () => {
		const ring = wrapTierA(cek, digest, reporter.key, seededRng(), CUSTODIANS);
		expect(ring.copies).toHaveLength(2);
		expect(quorumIsOffshoreBound(ring)).toBe(true);

		const byReporter = openSealedBox(reporter.secretKey, ring.copies[0]!.sealed);
		const byCustodian = openSealedBox(offshore.secretKey, ring.copies[1]!.sealed);
		expect(byReporter).toEqual(cek);
		expect(byCustodian).toEqual(cek);
	});

	it('gives the platform nothing: a copy cannot be opened by a stranger', () => {
		const ring = wrapTierA(cek, digest, reporter.key, seededRng(), CUSTODIANS);
		const stranger = new Uint8Array(32).fill(0x42);
		for (const copy of ring.copies) expect(openSealedBox(stranger, copy.sealed)).toBeNull();
	});
});

describe('tier B: the offshore share is mandatory in every quorum', () => {
	/**
	 * THE POINT OF THIS TIER. A plain Shamir 2-of-3 over
	 * {reporter, lawyer, offshore} is satisfied by {reporter, lawyer} -- both
	 * reachable in one jurisdiction, offshore not involved. That is exactly the
	 * compulsion §5.4 says this tier must defeat, so the construction splits the
	 * key rather than thresholding it.
	 */
	it('leaves every domestic holder together unable to recover the key', async () => {
		const ring = await wrapTierB(cek, digest, [reporter.key, lawyer.key], seededRng(), 1, CUSTODIANS);
		const domestic = ring.copies.filter((c) => c.holder !== 'custodian-offshore');
		expect(domestic).toHaveLength(2);

		const half1 = openSealedBox(reporter.secretKey, domestic[0]!.sealed)!;
		const half2 = openSealedBox(lawyer.secretKey, domestic[1]!.sealed)!;
		// Both domestic holders hold the same half, and it is not the key.
		expect(half1).toEqual(half2);
		expect(half1).not.toEqual(cek);
		expect(half1).toHaveLength(CEK_LENGTH);

		// And it is not the key under any wrong offshore half either. Stated as a
		// deterministic check rather than a statistical one about byte overlap:
		// an assertion that passes by coin flip is worse than none.
		for (const fill of [0x00, 0xff, 0x5a]) {
			expect(combineTierB(new Uint8Array(CEK_LENGTH).fill(fill), half1)).not.toEqual(cek);
		}
	});

	it('recovers the key from the offshore half plus one domestic half', async () => {
		const ring = await wrapTierB(cek, digest, [reporter.key, lawyer.key], seededRng(), 1, CUSTODIANS);
		const off = ring.copies.find((c) => c.holder === 'custodian-offshore')!;
		const dom = ring.copies.find((c) => c.holder === 'reporter')!;
		const kOffshore = openSealedBox(offshore.secretKey, off.sealed)!;
		const kDomestic = openSealedBox(reporter.secretKey, dom.sealed)!;
		expect(combineTierB(kOffshore, kDomestic)).toEqual(cek);
	});

	it('recovers with the lawyer instead of the reporter', async () => {
		const ring = await wrapTierB(cek, digest, [reporter.key, lawyer.key], seededRng(), 1, CUSTODIANS);
		const kOffshore = openSealedBox(
			offshore.secretKey,
			ring.copies.find((c) => c.holder === 'custodian-offshore')!.sealed
		)!;
		const kDomestic = openSealedBox(
			lawyer.secretKey,
			ring.copies.find((c) => c.holder === 'lawyer')!.sealed
		)!;
		expect(combineTierB(kOffshore, kDomestic)).toEqual(cek);
	});

	it('supports a domestic threshold above one via Shamir on the domestic half', async () => {
		const third = holder('reporter', 13);
		const ring = await wrapTierB(
			cek,
			digest,
			[reporter.key, lawyer.key, third.key],
			seededRng(),
			2,
			CUSTODIANS
		);
		expect(ring.copies).toHaveLength(4);
		// One domestic share alone is not the domestic half, so it cannot combine.
		const one = openSealedBox(reporter.secretKey, ring.copies[1]!.sealed)!;
		expect(one.length).not.toBe(CEK_LENGTH);
	});

	it('refuses to treat the offshore custodian as a domestic holder', async () => {
		await expect(
			wrapTierB(cek, digest, [offshore.key], seededRng(), 1, CUSTODIANS)
		).rejects.toThrow(/not a domestic holder/);
	});

	it('refuses a threshold it cannot satisfy', async () => {
		await expect(
			wrapTierB(cek, digest, [reporter.key], seededRng(), 2, CUSTODIANS)
		).rejects.toThrow(/threshold/);
	});
});

describe('wire encoding', () => {
	it('round-trips', async () => {
		const ring = await wrapTierB(cek, digest, [reporter.key, lawyer.key], seededRng(), 1, CUSTODIANS);
		const decoded = decodeKeyring(encodeKeyring(ring))!;
		expect(decoded.tier).toBe('B');
		expect(decoded.originalSha256).toEqual(digest);
		expect(decoded.copies.map((c) => c.holder)).toEqual(ring.copies.map((c) => c.holder));
		decoded.copies.forEach((c, i) => expect(c.sealed).toEqual(ring.copies[i]!.sealed));
	});

	it('rejects malformed blobs rather than throwing', () => {
		const ring = wrapTierA(cek, digest, reporter.key, seededRng(), CUSTODIANS);
		const good = encodeKeyring(ring);
		expect(decodeKeyring(new Uint8Array(0))).toBeNull();
		expect(decodeKeyring(good.subarray(0, good.length - 1))).toBeNull();
		// Trailing bytes are a malformed blob, not a longer valid one.
		expect(decodeKeyring(new Uint8Array([...good, 0]))).toBeNull();
		const badVersion = new Uint8Array(good);
		badVersion[0] = 9;
		expect(decodeKeyring(badVersion)).toBeNull();
	});

	it('carries no identity, timestamp or filename', () => {
		const ring = wrapTierA(cek, digest, reporter.key, seededRng(), CUSTODIANS);
		const encoded = encodeKeyring(ring);
		// Everything past the fixed header is sealed ciphertext plus lengths, so
		// the size is fully determined by the copies -- there is no room for a
		// field the platform could learn from.
		const expected = 35 + ring.copies.reduce((n, c) => n + 3 + c.sealed.length, 0);
		expect(encoded.length).toBe(expected);
	});
});
