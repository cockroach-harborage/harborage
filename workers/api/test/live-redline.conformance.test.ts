/**
 * RED-LINE CONFORMANCE for the live board (CLAUDE.md §1 red line 3;
 * ARCHITECTURE §6.3, §6.4; PRD §4.5).
 *
 * Not a unit suite. Each test here corresponds to a sentence in the charter, and
 * a failure means the platform has stopped being the thing it says it is:
 *
 *   "no live individual location, no who-was-where-when log"
 *   "the live board is zone-level, never finer than geohash-6"
 *   "suppress-until-safe-density"
 *   "SAFE_EXIT / DISPERSAL publish only with 2 valid marshal signatures;
 *    community versions without quorum are withheld, not shown low-confidence"
 *
 * WHY THE SCHEMA CHECK IS TESTED WITH AN EMPTY ENV. A route behind a credential
 * returns 401 before reaching the code under test, so with the credential first
 * every assertion below would pass with the schema rule deleted. Passing no
 * bindings is the proof that the refusal is structural.
 */
import { describe, expect, it } from 'vitest';
import { app } from '../src/app.ts';
import { SIGNAL_TYPES } from '@harborage/worker-lib/liveboard';
import {
	capCertBody,
	frameCapCert,
	framePop,
	popSigningBody,
	POP_NONCE_LENGTH
} from '@harborage/crypto/cap-cert';
import { SIGNING_ALG, SIG_CONTEXT } from '@harborage/crypto/compartments';
import { sign, signingKeypair } from '@harborage/crypto/hkdf-tree';
import { CAP_HEADER, ONE_SHOT_MAX_TTL_MS, POP_HEADER } from '@harborage/worker-lib/cap-cert';

const ZONE = 'IN-DL-z0417';
const noEnv = {} as never;

function only(...names: string[]) {
	return {
		get: async (k: string) =>
			names.includes(k.replace('flag:', ''))
				? JSON.stringify({ enabled: true, epoch: 1, updatedAt: '2026-07-26' })
				: null
	};
}

const rateLimit = {
	idFromName: (n: string) => n,
	get: () => ({ allow: async () => true, admit: async () => 'ok' })
};

/** Counts DO instantiations, so a test can assert what was NOT created. */
function countingNs() {
	const names: string[] = [];
	return {
		names,
		ns: {
			idFromName(n: string) {
				names.push(n);
				return n;
			},
			get: () => ({
				report: async () => 'accepted',
				view: async () => ({ tick: 0, zone_id: ZONE, rebuilding: false, band: null, signals: [] }),
				viewHeightened: async () => ({
					tick: 0,
					zone_id: ZONE,
					rebuilding: false,
					band: null,
					signals: []
				})
			})
		}
	};
}

/**
 * WHY THIS FILE MINTS A REAL CREDENTIAL.
 *
 * Everything after the credential check — the active-zone lookup, the fail-closed
 * catch, the marshal quorum — is UNREACHABLE from an unauthenticated request. A
 * test that posts no credential and asserts `not.toBe(202)` passes with all three
 * of those rules deleted, because the 401 fires first. Sabotaging each guard in
 * turn is what surfaced it: five of nine stayed green.
 *
 * So the suite signs. The seed is a fixed test key and the certificate is
 * self-issued, which is exactly what a real client does — a cap-cert authorises
 * nothing on its own.
 */
const SEED = new Uint8Array(32).fill(4);
const kp = signingKeypair(SEED);
let nonceCounter = 0;

function b64u(bytes: Uint8Array): string {
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
	return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
}

/** A long-lived `document` credential over this exact body, as the board requires. */
async function credentialHeaders(bodyText: string, ttlMs = 3600_000) {
	const now = Date.now();
	const fields = {
		algId: SIGNING_ALG.ed25519,
		compartment: 'document' as const,
		issuedAtMs: now,
		expiresAtMs: now + ttlMs,
		publicKey: kp.publicKey
	};
	const cert = frameCapCert(fields, sign(SIG_CONTEXT.capCert, capCertBody(fields), SEED));
	const nonce = new Uint8Array(POP_NONCE_LENGTH);
	new DataView(nonce.buffer).setUint32(0, ++nonceCounter);
	const message = popSigningBody({
		certHash: await sha256(cert),
		method: 'POST',
		path: '/api/live/report',
		timestampMs: now,
		nonce,
		bodyHash: await sha256(new TextEncoder().encode(bodyText))
	});
	const pop = framePop(now, nonce, sign(SIG_CONTEXT.pop, message, SEED));
	return { [CAP_HEADER]: b64u(cert), [POP_HEADER]: b64u(pop) };
}

/**
 * A D1 stub that records every statement, so a test can assert which reads did
 * NOT happen. "Refused before the directory was queried" is a stronger and more
 * stable claim than a status code alone.
 */
function db(opts: { zone?: 'active' | 'absent' | 'throws'; directory?: unknown[] } = {}) {
	const sqls: string[] = [];
	return {
		sqls,
		binding: {
			prepare(sql: string) {
				sqls.push(sql);
				const zone = opts.zone ?? 'absent';
				return {
					bind: () => ({
						first: async () => {
							if (zone === 'throws') throw new Error('d1 unavailable');
							return zone === 'active' ? { zone_id: ZONE } : null;
						}
					}),
					all: async () => ({ results: opts.directory ?? [] }),
					first: async () => null
				};
			}
		}
	};
}

function post(body: unknown, env: unknown) {
	return app.request(
		'/api/live/report',
		{ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
		env as never
	);
}

async function postSigned(body: unknown, env: unknown, ttlMs?: number) {
	const text = JSON.stringify(body);
	return app.request(
		'/api/live/report',
		{
			method: 'POST',
			headers: { 'content-type': 'application/json', ...(await credentialHeaders(text, ttlMs)) },
			body: text
		},
		env as never
	);
}

describe('RED LINE 3: no coordinate can be submitted, at all', () => {
	/**
	 * The charter forbids a live individual location and a persistent
	 * who-was-where log. The board's defence is that there is nowhere to PUT a
	 * position: the body shape has three keys and a coordinate is not one of them.
	 *
	 * Every one of these is refused with EXACTLY 400, on an empty env, so the
	 * refusal cannot be explained by a missing flag or a missing credential.
	 */
	it('refuses every coordinate-shaped field with exactly 400, touching no binding', async () => {
		const coordinateFields = [
			{ lat: 28.61 },
			{ lng: 77.2 },
			{ latitude: 28.61 },
			{ longitude: 77.2 },
			{ coords: { lat: 28.61, lng: 77.2 } },
			{ position: '28.61,77.20' },
			{ gps: '28.61,77.20' },
			{ accuracy_m: 5 },
			{ altitude: 216 },
			{ bearing: 90 },
			{ speed: 1.4 },
			{ geohash: 'ttnfv2u' },
			{ precise_location: 'x' }
		];
		for (const extra of coordinateFields) {
			const res = await post({ zone_id: ZONE, signal: 'TEAR_GAS', ...extra }, noEnv);
			expect(res.status, JSON.stringify(extra)).toBe(400);
		}
	});

	/** The positive control: without the extra key the same body gets further. */
	it('accepts the three-key shape, so the refusals above are about the extra key', async () => {
		const res = await post(
			{ zone_id: ZONE, signal: 'TEAR_GAS' },
			{
				FLAGS: only(),
				RATE_LIMIT: rateLimit
			}
		);
		// 403 from the flag, not 400 from the shape. Without this the test above
		// would pass against a handler that returned 400 unconditionally.
		expect(res.status).toBe(403);
	});
});

describe('RED LINE 3: zone-level only, from a signed list', () => {
	/**
	 * A zone is a NAME on a signed list, not a computed cell. An id that looks
	 * like a geohash is refused by shape, which is what stops a client inventing
	 * a finer cell than the list publishes.
	 */
	it('refuses a geohash-shaped or free-form zone id with exactly 400', async () => {
		for (const zone_id of [
			'IN-DL-tuvz9k',
			'ttnfv2u',
			'IN-DL-28.61-77.20',
			'IN-DL',
			'',
			'../../etc',
			'IN-DL-z0417-extra'
		]) {
			const res = await post({ zone_id, signal: 'TEAR_GAS' }, noEnv);
			expect(res.status, zone_id).toBe(400);
		}
	});

	/**
	 * live_zones ships with ZERO ROWS, so every well-formed zone is refused today.
	 * That is the production posture and it deserves a test rather than a comment.
	 */
	it('refuses a well-formed zone that is not on the active list, and creates no board', async () => {
		const b = countingNs();
		const res = await postSigned(
			{ zone_id: ZONE, signal: 'TEAR_GAS' },
			{
				FLAGS: only('live_board'),
				RATE_LIMIT: rateLimit,
				DB: db({ zone: 'absent' }).binding,
				LIVE_BOARD: b.ns
			}
		);
		expect(res.status).toBe(403);
		expect(b.names).toHaveLength(0);
	});

	/**
	 * The positive control for every signed test below. Same credential, same
	 * bindings, one row in live_zones: 202. Without this, "refuses" could mean the
	 * credential never verified and the whole file would be asserting nothing.
	 */
	it('accepts the same request once the zone is on the active list', async () => {
		const b = countingNs();
		const res = await postSigned(
			{ zone_id: ZONE, signal: 'TEAR_GAS' },
			{
				FLAGS: only('live_board'),
				RATE_LIMIT: rateLimit,
				DB: db({ zone: 'active' }).binding,
				LIVE_BOARD: b.ns
			}
		);
		expect(res.status).toBe(202);
		expect(b.names).toEqual(['zone:' + ZONE]);
	});
});

describe('RED LINE 3: writes fail closed', () => {
	it('refuses with exactly 403 while live_board is off', async () => {
		const res = await post(
			{ zone_id: ZONE, signal: 'TEAR_GAS' },
			{
				FLAGS: only(),
				RATE_LIMIT: rateLimit
			}
		);
		expect(res.status).toBe(403);
		expect(await res.text()).toBe('not open');
	});

	it('creates no board instance while the flag is off', async () => {
		const b = countingNs();
		await post(
			{ zone_id: ZONE, signal: 'TEAR_GAS' },
			{
				FLAGS: only(),
				RATE_LIMIT: rateLimit,
				LIVE_BOARD: b.ns
			}
		);
		expect(b.names).toHaveLength(0);
	});

	/**
	 * A DB read failure on a WRITE path fails closed, not open. Signed, because an
	 * unsigned request never reaches the lookup and the test would pass with the
	 * catch deleted.
	 */
	it('refuses when the zone lookup itself fails, and creates no board', async () => {
		const b = countingNs();
		const res = await postSigned(
			{ zone_id: ZONE, signal: 'TEAR_GAS' },
			{
				FLAGS: only('live_board'),
				RATE_LIMIT: rateLimit,
				DB: db({ zone: 'throws' }).binding,
				LIVE_BOARD: b.ns
			}
		);
		expect(res.status).toBe(403);
		expect(b.names).toHaveLength(0);
	});

	/**
	 * THE ONE PLACE M4's ONE-SHOT MACHINERY IS ACTIVELY WRONG. The dedup token
	 * derives from the certificate hash, so a per-request certificate is a fresh
	 * apparent reporter every heartbeat and the density floor stops meaning
	 * anything. Refused explicitly rather than left to being unusual.
	 */
	it('refuses a short-lived certificate on an otherwise valid report', async () => {
		const env = {
			FLAGS: only('live_board'),
			RATE_LIMIT: rateLimit,
			DB: db({ zone: 'active' }).binding,
			LIVE_BOARD: countingNs().ns
		};
		const body = { zone_id: ZONE, signal: 'TEAR_GAS' };
		// Identical in every respect except the claimed lifetime.
		expect((await postSigned(body, env, ONE_SHOT_MAX_TTL_MS - 1_000)).status).toBe(401);
		expect((await postSigned(body, env, 3600_000)).status).toBe(202);
	});
});

describe('the signal vocabulary is closed', () => {
	it('refuses anything outside the nine signals with exactly 400', async () => {
		for (const signal of [
			'ARREST_OF',
			'PERSON_HERE',
			'I_AM_HERE',
			'crowd_count',
			'',
			'TEAR_GAS '
		]) {
			const res = await post({ zone_id: ZONE, signal }, noEnv);
			expect(res.status, signal).toBe(400);
		}
	});

	/**
	 * Every accepted signal describes a CONDITION, never a person. §4.5 is
	 * explicit that condition data carries far less targeting value than
	 * protestor location, and this is what keeps the vocabulary on that side.
	 */
	it('has no signal that describes a person, a headcount, or a self-location', async () => {
		// Anchored patterns. A loose /me/ matched POLICE_MOVEMENT, which is a
		// CONDITION (police are moving through this area) and exactly the kind of
		// signal the board is for. A gate or a test that false-fires on correct
		// input is one somebody weakens.
		for (const s of SIGNAL_TYPES) {
			expect(s, s).not.toMatch(/\b(person|people|individual|suspect|arrested?|name|face|plate)\b/i);
			expect(s, s).not.toMatch(/crowd|headcount|how_many|_count\b|\bcount_/i);
			expect(s, s).not.toMatch(/\bi_am\b|\bmy_|_here\b/i);
		}
	});
});

describe('SAFE_EXIT and DISPERSAL are refused at ingest without a quorum', () => {
	/**
	 * §6.3: a community version without quorum is WITHHELD, not shown with lower
	 * confidence. Refusing at INGEST rather than at read means an unquorumed
	 * evacuation route is never stored at all, so no later code path can decide to
	 * surface it.
	 */
	it('refuses with no marshal bundle, before the key directory is even read', async () => {
		for (const signal of ['SAFE_EXIT', 'DISPERSAL']) {
			const b = countingNs();
			const d = db({ zone: 'active' });
			const res = await postSigned(
				{ zone_id: ZONE, signal },
				{
					FLAGS: only('live_board'),
					RATE_LIMIT: rateLimit,
					DB: d.binding,
					LIVE_BOARD: b.ns
				}
			);
			expect(res.status, signal).toBe(403);
			expect(b.names, signal).toHaveLength(0);
			// The stronger claim, and the one a status code alone does not make: an
			// unquorumed evacuation route costs no directory read and no DO instance.
			expect(
				d.sqls.some((q) => q.includes('key_directory')),
				signal
			).toBe(false);
		}
	});

	/**
	 * A well-formed bundle that does not verify. key_directory ships EMPTY, so no
	 * quorum is satisfiable today and this is the resting state, not a contrived
	 * one. Separate from the test above because that one returns before
	 * verifyRoleQuorum is ever called.
	 */
	it('refuses a bundle that does not verify against the directory', async () => {
		const b = countingNs();
		const d = db({ zone: 'active', directory: [] });
		const res = await postSigned(
			{
				zone_id: ZONE,
				signal: 'SAFE_EXIT',
				marshal: { hashHex: '00'.repeat(32), signatures: [{ key_id: 'm1', sig: 'AAAA' }] }
			},
			{ FLAGS: only('live_board'), RATE_LIMIT: rateLimit, DB: d.binding, LIVE_BOARD: b.ns }
		);
		expect(res.status).toBe(403);
		expect(b.names).toHaveLength(0);
		// It really did get as far as the directory, so the 403 is the quorum's.
		expect(d.sqls.some((q) => q.includes('key_directory'))).toBe(true);
	});

	/**
	 * An ordinary hazard needs no bundle, so the refusals above are about the
	 * quorum and not about the route being closed to everything.
	 */
	it('does not demand a bundle of an ordinary hazard', async () => {
		const res = await postSigned(
			{ zone_id: ZONE, signal: 'TEAR_GAS' },
			{
				FLAGS: only('live_board'),
				RATE_LIMIT: rateLimit,
				DB: db({ zone: 'active' }).binding,
				LIVE_BOARD: countingNs().ns
			}
		);
		expect(res.status).toBe(202);
	});
});

describe('the response is not an oracle', () => {
	/**
	 * The route returns one flat shape whatever the board did. The board's own
	 * view, delayed and floored, is the only channel a reporter has to learn board
	 * state, and a status or body that varied with the outcome would be a side
	 * channel around it.
	 */
	it('carries no count, no band and no signal state in any refusal', async () => {
		const bodies: string[] = [];
		for (const env of [
			{ FLAGS: only(), RATE_LIMIT: rateLimit },
			{ FLAGS: only('live_board'), RATE_LIMIT: rateLimit }
		]) {
			const res = await post({ zone_id: ZONE, signal: 'TEAR_GAS' }, env);
			bodies.push(await res.text());
		}
		for (const b of bodies) {
			expect(b).not.toMatch(/\d+\s*(reporter|report|people)/i);
			expect(b).not.toMatch(/none|small|moderate|large|very-large/);
			expect(b).not.toMatch(/floor|density|corroborat/i);
		}
	});
});
