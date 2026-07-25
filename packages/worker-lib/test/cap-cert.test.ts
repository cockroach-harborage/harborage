/**
 * Policy negative suite. Every one of these is a way a request could be
 * accepted that must not be, so the file is mostly failures on purpose.
 */
import { describe, expect, it } from 'vitest';
import {
	capCertBody,
	frameCapCert,
	framePop,
	popSigningBody,
	POP_NONCE_LENGTH,
	type CapCertFields
} from '@harborage/crypto/cap-cert';
import { SIGNING_ALG, SIG_CONTEXT, type Compartment } from '@harborage/crypto/compartments';
import { sign, signingKeypair } from '@harborage/crypto/hkdf-tree';
import {
	CAP_HEADER,
	DEFAULT_POLICY,
	nonceRetentionMs,
	POP_HEADER,
	ONE_SHOT_MAX_TTL_MS,
	verifyRequestCredential,
	type Admission,
	type CredentialFailure
} from '../src/cap-cert.ts';

const SEED = new Uint8Array(32).fill(4);
const OTHER_SEED = new Uint8Array(32).fill(9);
const kp = signingKeypair(SEED);
const NOW = 1_760_000_000_000;
const URL_REGISTER = 'https://cockroachharborage.org/api/incidents/register';
const BODY = new Uint8Array([1, 2, 3]);

/** noUncheckedIndexedAccess makes a bare `buf[i] ^= x` an error. */
function flip(buf: Uint8Array, index: number, mask = 0xff): Uint8Array {
	buf[index] = (buf[index] ?? 0) ^ mask;
	return buf;
}

function b64u(bytes: Uint8Array): string {
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
	return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
}

function certFields(over: Partial<CapCertFields> = {}): CapCertFields {
	return {
		algId: SIGNING_ALG.ed25519,
		compartment: 'document',
		issuedAtMs: NOW,
		expiresAtMs: NOW + 3600_000,
		publicKey: kp.publicKey,
		...over
	};
}

function makeCert(over: Partial<CapCertFields> = {}, seed = SEED): Uint8Array {
	const f = certFields(over);
	return frameCapCert(f, sign(SIG_CONTEXT.capCert, capCertBody(f), seed));
}

async function makePop(
	certBytes: Uint8Array,
	opts: {
		method?: string;
		path?: string;
		timestampMs?: number;
		nonce?: Uint8Array;
		body?: Uint8Array;
		seed?: Uint8Array;
	} = {}
): Promise<Uint8Array> {
	const ts = opts.timestampMs ?? NOW;
	const nonce = opts.nonce ?? new Uint8Array(POP_NONCE_LENGTH).fill(7);
	const message = popSigningBody({
		certHash: await sha256(certBytes),
		method: opts.method ?? 'POST',
		path: opts.path ?? '/api/incidents/register',
		timestampMs: ts,
		nonce,
		bodyHash: await sha256(opts.body ?? BODY)
	});
	return framePop(ts, nonce, sign(SIG_CONTEXT.pop, message, opts.seed ?? SEED));
}

function request(headers: Record<string, string>, url = URL_REGISTER, method = 'POST') {
	return {
		method,
		url,
		headers: { get: (name: string) => headers[name] ?? null }
	};
}

async function verify(
	headers: Record<string, string>,
	over: {
		url?: string;
		method?: string;
		body?: Uint8Array;
		nowMs?: number;
		compartment?: Compartment;
		admission?: Admission;
	} = {}
) {
	return verifyRequestCredential(
		request(headers, over.url ?? URL_REGISTER, over.method ?? 'POST'),
		over.body ?? BODY,
		{
			nowMs: over.nowMs ?? NOW,
			compartment: over.compartment ?? 'document',
			...(over.admission ? { admission: over.admission } : {})
		}
	);
}

async function headersFor(
	certOver: Partial<CapCertFields> = {},
	popOver: Parameters<typeof makePop>[1] = {},
	certSeed = SEED
) {
	const cert = makeCert(certOver, certSeed);
	return {
		cert,
		headers: { [CAP_HEADER]: b64u(cert), [POP_HEADER]: b64u(await makePop(cert, popOver)) }
	};
}

async function expectFailure(
	headers: Record<string, string>,
	reason: CredentialFailure,
	over?: Parameters<typeof verify>[1]
) {
	const result = await verify(headers, over);
	expect(result.ok).toBe(false);
	if (!result.ok) expect(result.reason).toBe(reason);
}

describe('happy path', () => {
	it('accepts a fresh, correctly bound credential', async () => {
		const { headers } = await headersFor();
		const result = await verify(headers);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.cert.compartment).toBe('document');
			expect(result.nonceHex).toBe('07'.repeat(POP_NONCE_LENGTH));
			expect(result.certHashHex).toHaveLength(64);
		}
	});

	it('tolerates a client clock a few minutes off', async () => {
		const skew = DEFAULT_POLICY.maxSkewMs - 1000;
		const { headers } = await headersFor(
			{ issuedAtMs: NOW + skew, expiresAtMs: NOW + skew + 3600_000 },
			{ timestampMs: NOW + skew }
		);
		expect((await verify(headers)).ok).toBe(true);
	});
});

describe('presence and shape', () => {
	it('rejects a request with no credential at all', async () => {
		await expectFailure({}, 'missing');
	});

	it('rejects a certificate with no proof, and a proof with no certificate', async () => {
		const { headers } = await headersFor();
		await expectFailure({ [CAP_HEADER]: headers[CAP_HEADER]! }, 'missing');
		await expectFailure({ [POP_HEADER]: headers[POP_HEADER]! }, 'missing');
	});

	// One compartment per session, enforced. Workers join repeated headers with
	// ", ", so two credentials arrive as one comma-joined value.
	it('rejects a two-compartment request rather than picking one', async () => {
		const a = await headersFor();
		const b = await headersFor({ compartment: 'directory' });
		await expectFailure(
			{
				[CAP_HEADER]: `${a.headers[CAP_HEADER]}, ${b.headers[CAP_HEADER]}`,
				[POP_HEADER]: a.headers[POP_HEADER]!
			},
			'two-compartment'
		);
		await expectFailure(
			{
				[CAP_HEADER]: a.headers[CAP_HEADER]!,
				[POP_HEADER]: `${a.headers[POP_HEADER]}, ${b.headers[POP_HEADER]}`
			},
			'two-compartment'
		);
	});

	it('rejects junk, bad base64 and truncated values', async () => {
		const { headers } = await headersFor();
		await expectFailure({ ...headers, [CAP_HEADER]: 'not base64 !!' }, 'malformed-cert');
		await expectFailure({ ...headers, [CAP_HEADER]: b64u(new Uint8Array(10)) }, 'malformed-cert');
		await expectFailure({ ...headers, [POP_HEADER]: b64u(new Uint8Array(10)) }, 'malformed-pop');
	});

	it('rejects an unknown algorithm id', async () => {
		const { cert } = await headersFor();
		const bad = cert.slice();
		bad[5] = 42;
		await expectFailure(
			{ [CAP_HEADER]: b64u(bad), [POP_HEADER]: b64u(await makePop(cert)) },
			'malformed-cert'
		);
	});
});

describe('compartment policy', () => {
	it('rejects a certificate for a different compartment than the endpoint', async () => {
		const { headers } = await headersFor({ compartment: 'directory' });
		await expectFailure(headers, 'wrong-compartment');
	});

	// M4 activated `medical` and `aid`, so this now uses `legal`, which is still
	// a reserved name. The compartment enum is closed and append-only precisely
	// so a reserved name can exist in the type system years before any endpoint
	// will accept one.
	it('rejects a compartment that is reserved but not active yet', async () => {
		const { headers } = await headersFor({ compartment: 'legal' });
		await expectFailure(headers, 'wrong-compartment', { compartment: 'document' });

		// Even when the endpoint asks for it, an inactive compartment is refused.
		const { headers: h2 } = await headersFor({ compartment: 'legal' });
		const result = await verifyRequestCredential(request(h2), BODY, {
			nowMs: NOW,
			compartment: 'legal'
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe('inactive-compartment');
	});
});

describe('clocks', () => {
	it('rejects a certificate that has expired', async () => {
		const { headers } = await headersFor({
			issuedAtMs: NOW - 7200_000,
			expiresAtMs: NOW - 3600_000
		});
		await expectFailure(headers, 'cert-expired');
	});

	it('rejects a certificate issued too far in the future', async () => {
		const future = NOW + DEFAULT_POLICY.maxSkewMs + 60_000;
		const { headers } = await headersFor(
			{ issuedAtMs: future, expiresAtMs: future + 3600_000 },
			{ timestampMs: future }
		);
		await expectFailure(headers, 'cert-not-yet-valid');
	});

	// A self-issued certificate could otherwise claim a ten-year life, which
	// would make the credential effectively permanent.
	it('rejects a certificate claiming a longer life than policy allows', async () => {
		const { headers } = await headersFor({
			expiresAtMs: NOW + DEFAULT_POLICY.maxTtlMs + 60_000
		});
		await expectFailure(headers, 'cert-ttl-too-long');
	});

	it('rejects a certificate that expires before it was issued', async () => {
		const { headers } = await headersFor({ expiresAtMs: NOW - 1 });
		await expectFailure(headers, 'cert-expired');
	});

	it('rejects a stale proof even inside a valid certificate', async () => {
		const stale = NOW - DEFAULT_POLICY.popWindowMs - DEFAULT_POLICY.maxSkewMs - 1000;
		const { headers } = await headersFor({}, { timestampMs: stale });
		await expectFailure(headers, 'pop-stale');
	});

	it('rejects a proof dated in the future', async () => {
		const ahead = NOW + DEFAULT_POLICY.maxSkewMs + 60_000;
		const { headers } = await headersFor({}, { timestampMs: ahead });
		await expectFailure(headers, 'pop-future');
	});
});

describe('signatures and binding', () => {
	it('rejects a certificate signed by a key it does not carry', async () => {
		const { headers } = await headersFor({}, {}, OTHER_SEED);
		await expectFailure(headers, 'cert-bad-signature');
	});

	it('rejects a certificate whose public key was swapped', async () => {
		const { cert } = await headersFor();
		const tampered = cert.slice();
		flip(tampered, 25); // inside the public key, so only the signature notices
		await expectFailure(
			{ [CAP_HEADER]: b64u(tampered), [POP_HEADER]: b64u(await makePop(cert)) },
			'cert-bad-signature'
		);
	});

	// Flipping a byte in a time field is caught by an earlier, cheaper rule than
	// the signature check. Which rule fires is not the point; that nothing gets
	// through is. Asserting a specific reason here would make the test brittle
	// against a reordering that is still correct.
	it('rejects a certificate tampered anywhere, whichever rule catches it first', async () => {
		const { cert } = await headersFor();
		const pop = b64u(await makePop(cert));
		for (const offset of [6, 10, 14, 18, 22, 25, 40, cert.length - 1]) {
			const tampered = cert.slice();
			flip(tampered, offset);
			const result = await verify({ [CAP_HEADER]: b64u(tampered), [POP_HEADER]: pop });
			expect(result.ok, `offset ${offset} was accepted`).toBe(false);
		}
	});

	it('rejects a tampered proof', async () => {
		const { cert, headers } = await headersFor();
		const pop = await makePop(cert);
		flip(pop, pop.length - 1, 0x01);
		await expectFailure({ ...headers, [POP_HEADER]: b64u(pop) }, 'pop-bad-signature');
	});

	// The captured-proof case: a valid proof from one credential presented with
	// a different, also-valid credential.
	it('rejects a proof issued under a different certificate', async () => {
		const a = makeCert();
		const b = makeCert({ issuedAtMs: NOW + 1 });
		await expectFailure(
			{ [CAP_HEADER]: b64u(b), [POP_HEADER]: b64u(await makePop(a)) },
			'pop-bad-signature'
		);
	});

	it('rejects a proof signed by a key other than the certificate holder', async () => {
		const cert = makeCert();
		await expectFailure(
			{ [CAP_HEADER]: b64u(cert), [POP_HEADER]: b64u(await makePop(cert, { seed: OTHER_SEED })) },
			'pop-bad-signature'
		);
	});

	it('rejects a proof replayed against a different path or method', async () => {
		const { headers } = await headersFor();
		await expectFailure(headers, 'pop-bad-signature', {
			url: 'https://cockroachharborage.org/api/directory/report'
		});
		await expectFailure(headers, 'pop-bad-signature', { method: 'PUT' });
	});

	// Without a body hash in the proof, a captured credential could be reused to
	// post entirely different content.
	it('rejects a proof replayed against a different body', async () => {
		const { headers } = await headersFor();
		await expectFailure(headers, 'pop-bad-signature', { body: new Uint8Array([9, 9, 9]) });
	});
});

describe('nonce retention', () => {
	// Anything shorter than the full window in which a proof still passes the
	// freshness check would reopen the replay hole at the edge of the allowance.
	it('covers the whole window in which a proof could still be fresh', () => {
		expect(nonceRetentionMs({})).toBeGreaterThanOrEqual(
			DEFAULT_POLICY.popWindowMs + DEFAULT_POLICY.maxSkewMs
		);
	});
});

/**
 * ONE-SHOT ADMISSION.
 *
 * Every rule below is INVISIBLE FROM A ROUTE TEST. /api/aid/* returns a flat 401
 * for all of them, and 403 before that when the flag is off, so a route test
 * asserting "not 202" passes with the whole block deleted. That is exactly why
 * the policy lives in this pure verifier and is tested here.
 */
describe('one-shot admission', () => {
	const AID_URL = 'https://cockroachharborage.org/api/aid/need';
	const AID_PATH = '/api/aid/need';

	async function aidHeaders(over: Partial<CapCertFields> = {}) {
		const cert = makeCert({ compartment: 'aid', ...over });
		return {
			[CAP_HEADER]: b64u(cert),
			[POP_HEADER]: b64u(await makePop(cert, { path: AID_PATH }))
		};
	}

	/**
	 * The rule that stops M4's widening of ACTIVE_COMPARTMENTS from quietly
	 * letting an hour-long reusable certificate onto the broker. Delete it and a
	 * brokered request becomes linkable to every other request that key signed.
	 */
	it('refuses a brokered compartment on an endpoint that did not ask for one-shot', async () => {
		const res = await verify(await aidHeaders(), { url: AID_URL, compartment: 'aid' });
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.reason).toBe<CredentialFailure>('one-shot-required');
	});

	it('accepts the same certificate when the endpoint asks for one-shot', async () => {
		const res = await verify(await aidHeaders({ expiresAtMs: NOW + 2 * 60_000 }), {
			url: AID_URL,
			compartment: 'aid',
			admission: 'one-shot'
		});
		expect(res.ok).toBe(true);
	});

	/**
	 * The TTL clamp. It does NOT verify one-shot-ness, which is unobservable on
	 * the wire; it bounds the cost of being wrong. A certificate minted for one
	 * request must not claim to outlive the window in which its own proof is
	 * still fresh.
	 */
	it('clamps a one-shot certificate to the proof-freshness window', async () => {
		const res = await verify(await aidHeaders({ expiresAtMs: NOW + 24 * 60 * 60_000 }), {
			url: AID_URL,
			compartment: 'aid',
			admission: 'one-shot'
		});
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.reason).toBe<CredentialFailure>('cert-ttl-too-long');
	});

	it('accepts a certificate at exactly the one-shot ceiling', async () => {
		const res = await verify(await aidHeaders({ expiresAtMs: NOW + ONE_SHOT_MAX_TTL_MS }), {
			url: AID_URL,
			compartment: 'aid',
			admission: 'one-shot'
		});
		expect(res.ok).toBe(true);
	});

	/** An endpoint may not raise the ceiling by passing a longer maxTtlMs. */
	it('ignores a maxTtlMs that tries to exceed the one-shot ceiling', async () => {
		const cert = makeCert({ compartment: 'aid', expiresAtMs: NOW + 60 * 60_000 });
		const res = await verifyRequestCredential(
			request(
				{ [CAP_HEADER]: b64u(cert), [POP_HEADER]: b64u(await makePop(cert, { path: AID_PATH })) },
				AID_URL
			),
			BODY,
			{
				nowMs: NOW,
				compartment: 'aid',
				admission: 'one-shot',
				maxTtlMs: 24 * 60 * 60_000
			}
		);
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.reason).toBe<CredentialFailure>('cert-ttl-too-long');
	});

	/**
	 * A one-shot identity on an ordinarily-cached compartment is a privacy
	 * improvement, not an error. Refusing it would push callers back toward the
	 * cache for no reason.
	 */
	it('allows one-shot admission on a cached compartment', async () => {
		const { headers } = await headersFor({ expiresAtMs: NOW + 2 * 60_000 });
		const res = await verify(headers, { admission: 'one-shot' });
		expect(res.ok).toBe(true);
	});

	/** A reserved-but-inactive compartment is still refused, ahead of everything. */
	it('still refuses a compartment that is not active at all', async () => {
		const cert = makeCert({ compartment: 'legal' });
		const res = await verifyRequestCredential(
			request(
				{ [CAP_HEADER]: b64u(cert), [POP_HEADER]: b64u(await makePop(cert, { path: AID_PATH })) },
				AID_URL
			),
			BODY,
			{ nowMs: NOW, compartment: 'legal', admission: 'one-shot' }
		);
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.reason).toBe<CredentialFailure>('inactive-compartment');
	});
});
