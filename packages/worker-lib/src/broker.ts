/**
 * Brokered-channel primitives (ARCHITECTURE §5.3, §9.3; PRD §4.7–4.9).
 *
 * Pure: framing, padding, inbox tokens and the tick grid. No Durable Object, no
 * bindings, no ambient state. The Broker and Mailbox classes are thin wrappers
 * around what is here, which is what lets the confidentiality properties be
 * tested directly instead of through a route that returns a flat 401 or 403 to
 * every probe.
 *
 * WHAT THE PLATFORM SEES. A routing prefix (region, category), an opaque
 * commitment, an opaque handle reference, and a sealed box it holds no key for.
 * It never sees who is asking, what they need, or where they are beyond a
 * state-level bucket held in memory for minutes.
 */

/** Every brokered body is exactly this long, in both phases. */
export const BROKER_FRAME_LEN = 4 * 1024;

/** Quantum of the delivery grid. */
export const TICK_MS = 5_000;

/**
 * A poll lasts exactly this many ticks whether or not a message is waiting.
 *
 * FIXED DURATION IS AS LOAD-BEARING AS FIXED LENGTH. Returning early on
 * delivery would make round-trip time a perfect message-presence oracle, which
 * no amount of length padding repairs.
 */
export const POLL_WAIT_TICKS = 4;

/**
 * Closed category vocabulary. `shelter_org` is deliberately the only
 * accommodation-shaped value and it means an ORGANISATION with premises: PRD
 * §4.8's interlock is that short-term housing is brokered only through vetted
 * institutional shelters, never stranger-to-home, and a vocabulary with no word
 * for the latter is the cheapest way to keep that true.
 */
export const AID_CATEGORIES = [
	'food',
	'water',
	'transport',
	'supplies',
	'shelter_org',
	'translation',
	'legal_intake'
] as const;
export type AidCategory = (typeof AID_CATEGORIES)[number];

/**
 * Region granularity for broker addressing: a signed state or district code,
 * never finer. Coarser than the live board's geohash-6, because a broker
 * instance is long-lived relative to a hazard signal and its occupancy is
 * itself a signal.
 */
const REGION_RE = /^[A-Z]{2}(-[A-Z0-9]{2,3}){1,2}$/;
const MIN_REGION_LEN = 5;
const MAX_REGION_LEN = 12;

export const COMMIT_LEN = 32;
export const HANDLE_LEN = 16;
const BROKER_REF_LEN = 4;

/**
 * TWO LENGTHS, NOT ONE, and the first draft of this file collapsed them.
 *
 * `HANDLE_REF_LEN` is what a client echoes back to name an open need:
 * `version(1) ‖ brokerRef(4) ‖ handle(16)`. `TOKEN_HEAD_LEN` is the authenticated
 * head of an inbox token, which is the same thing plus the slot byte. Using one
 * constant for both made verifyInboxToken read one byte short, so EVERY token
 * failed to verify.
 *
 * That bug shipped green past two tamper tests, because "refuses a tampered
 * token" is also satisfied by "refuses every token". Only the positive
 * round-trip caught it, which is the argument for keeping a positive control
 * beside every negative one.
 */
const HANDLE_REF_LEN = 1 + BROKER_REF_LEN + HANDLE_LEN;
const TOKEN_HEAD_LEN = HANDLE_REF_LEN + 1;
const TOKEN_TAG_LEN = 16;
const TOKEN_VERSION = 1;

const INBOX_CONTEXT = 'harborage/inbox/v1';
const BROKER_CONTEXT = 'harborage/broker/v1';

/** Header(5) + prefix + at least one sealed box (epk 32 + nonce 24 + tag 16). */
const MIN_SEALED = 32 + 24 + 16;

export interface BrokerFrame {
	region: string;
	category: AidCategory;
	/** SHA-256 of the seeker's secret. All-zero when not applicable. */
	commit: Uint8Array;
	/** Opaque reference to an open need. All-zero on an announce. */
	handleRef: Uint8Array;
	/** The sealed box plus padding. Opaque here. */
	sealed: Uint8Array;
}

function concat(...parts: Uint8Array[]): Uint8Array {
	let n = 0;
	for (const p of parts) n += p.length;
	const out = new Uint8Array(n);
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
}

/** Constant-time compare. Length is public; contents are not. */
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
	return diff === 0;
}

function b64u(bytes: Uint8Array): string {
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function unb64u(s: string): Uint8Array | null {
	if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
	try {
		const bin = atob(s.replaceAll('-', '+').replaceAll('_', '/'));
		return Uint8Array.from(bin, (c) => c.charCodeAt(0));
	} catch {
		return null;
	}
}

/**
 * Parse the clear prefix of a brokered frame.
 *
 * Refuses anything that is not EXACTLY BROKER_FRAME_LEN. A short frame is not
 * merely malformed: accepting one would reintroduce the size channel this whole
 * lane exists to close.
 */
export function parseBrokerFrame(buf: Uint8Array): BrokerFrame | null {
	if (buf.length !== BROKER_FRAME_LEN) return null;
	// Skip the 5-byte envelope header; the caller has already checked it.
	let at = 5;
	const regionLen = buf[at++] ?? 0;
	if (regionLen < MIN_REGION_LEN || regionLen > MAX_REGION_LEN) return null;
	const region = new TextDecoder().decode(buf.subarray(at, at + regionLen));
	if (!REGION_RE.test(region)) return null;
	at += MAX_REGION_LEN; // fixed-width field, so the offset does not leak the length

	const categoryOrdinal = buf[at++] ?? 0xff;
	const category = AID_CATEGORIES[categoryOrdinal];
	if (category === undefined) return null;

	const commit = buf.subarray(at, at + COMMIT_LEN);
	at += COMMIT_LEN;
	const handleRef = buf.subarray(at, at + HANDLE_REF_LEN);
	at += HANDLE_REF_LEN;

	const sealed = buf.subarray(at);
	if (sealed.length < MIN_SEALED) return null;
	return { region, category, commit, handleRef, sealed };
}

/** Build a frame. Client-side helper, and what the tests use to make real input. */
export function buildBrokerFrame(f: {
	region: string;
	category: AidCategory;
	commit?: Uint8Array;
	handleRef?: Uint8Array;
	sealed: Uint8Array;
}): Uint8Array {
	const out = new Uint8Array(BROKER_FRAME_LEN);
	out.set([0x48, 0x42, 0x45, 0x31, 4], 0); // "HBE1" + ALG_BROKER_ONESHOT
	let at = 5;
	const region = new TextEncoder().encode(f.region);
	out[at++] = region.length;
	out.set(region, at);
	at += MAX_REGION_LEN;
	out[at++] = AID_CATEGORIES.indexOf(f.category);
	if (f.commit) out.set(f.commit.subarray(0, COMMIT_LEN), at);
	at += COMMIT_LEN;
	if (f.handleRef) out.set(f.handleRef.subarray(0, HANDLE_REF_LEN), at);
	at += HANDLE_REF_LEN;
	out.set(f.sealed.subarray(0, BROKER_FRAME_LEN - at), at);
	return out;
}

async function hmac(keyRaw: string, message: Uint8Array): Promise<Uint8Array> {
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(keyRaw),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	return new Uint8Array(await crypto.subtle.sign('HMAC', key, message as BufferSource));
}

/**
 * The Durable Object instance name for one (region, category) broker.
 *
 * Derived rather than concatenated, so the instance name is an opaque hex id
 * and not the string "br:IN-DL:legal_intake". A Durable Object name is not
 * content, but it is an identifier that appears in platform-side plumbing, and
 * there is no reason for it to spell out which district's legal-intake queue is
 * busy.
 *
 * Absent key ⇒ null ⇒ the caller refuses. Same resting state as the onion
 * ingress key: no secret, no service.
 */
export async function brokerRef(
	macKey: string | undefined,
	region: string,
	category: AidCategory
): Promise<Uint8Array | null> {
	if (!macKey) return null;
	if (!REGION_RE.test(region)) return null;
	const mac = await hmac(
		macKey,
		new TextEncoder().encode(`${BROKER_CONTEXT}/${region}/${category}`)
	);
	return mac.subarray(0, BROKER_REF_LEN);
}

export function brokerName(ref: Uint8Array): string {
	let s = 'b:';
	for (const b of ref) s += b.toString(16).padStart(2, '0');
	return s;
}

/**
 * Mint an inbox token.
 *
 * Layout: `ver(1) ‖ brokerRef(4) ‖ handle(16) ‖ slot(1) ‖ tag(16)`, base64url.
 *
 * SELF-DESCRIBING ON PURPOSE. The Worker can verify a token without being told
 * what went into it, which means verification happens BEFORE any Durable Object
 * is addressed. A forged token therefore costs zero instances. Without the MAC,
 * a caller could mint unbounded Mailbox instances by inventing handles, which is
 * the same amplification admitOneShot exists to close, one layer up.
 */
export async function mintInboxToken(
	macKey: string | undefined,
	ref: Uint8Array,
	handle: Uint8Array,
	slot: number
): Promise<string | null> {
	if (!macKey) return null;
	if (ref.length !== BROKER_REF_LEN || handle.length !== HANDLE_LEN) return null;
	if (!Number.isInteger(slot) || slot < 0 || slot > 255) return null;
	const head = concat(new Uint8Array([TOKEN_VERSION]), ref, handle, new Uint8Array([slot]));
	const tag = (await hmac(macKey, concat(new TextEncoder().encode(INBOX_CONTEXT), head))).subarray(
		0,
		TOKEN_TAG_LEN
	);
	return b64u(concat(head, tag));
}

export interface InboxToken {
	brokerRef: Uint8Array;
	handle: Uint8Array;
	slot: number;
}

/** Verify and unpack. Null for anything unverified: no partial results. */
export async function verifyInboxToken(
	macKey: string | undefined,
	token: string
): Promise<InboxToken | null> {
	// Absent key ⇒ nothing verifies ⇒ every brokered route refuses for everyone.
	// The correct resting state while no broker is operated.
	if (!macKey) return null;
	const raw = unb64u(token);
	if (!raw || raw.length !== TOKEN_HEAD_LEN + TOKEN_TAG_LEN) return null;
	if (raw[0] !== TOKEN_VERSION) return null;
	const head = raw.subarray(0, TOKEN_HEAD_LEN);
	const tag = raw.subarray(TOKEN_HEAD_LEN);
	const expected = (
		await hmac(macKey, concat(new TextEncoder().encode(INBOX_CONTEXT), head))
	).subarray(0, TOKEN_TAG_LEN);
	if (!equalBytes(expected, tag)) return null;
	return {
		brokerRef: head.subarray(1, 1 + BROKER_REF_LEN),
		handle: head.subarray(1 + BROKER_REF_LEN, 1 + BROKER_REF_LEN + HANDLE_LEN),
		slot: head[TOKEN_HEAD_LEN - 1] ?? 0
	};
}

/** The 17-byte reference a client echoes back to name an open need. */
export function handleRefOf(ref: Uint8Array, handle: Uint8Array): Uint8Array {
	return concat(new Uint8Array([TOKEN_VERSION]), ref, handle);
}

/**
 * Pad a poll response to exactly one length.
 *
 * NO STATUS BYTE, and the filler is RANDOM rather than zero. A status byte is a
 * free tell to anyone who sees the plaintext response; zero-fill would be a
 * compression oracle the moment anything downstream gzips. An empty poll is
 * BROKER_FRAME_LEN random bytes, and the client's attempt to open it returns
 * null.
 *
 * SCOPE OF THE CLAIM, and it is load-bearing. Fixed length plus fixed duration
 * makes an empty poll and a delivering poll indistinguishable TO THE ISP AND
 * ANYONE DOWNSTREAM OF TLS. It hides nothing from Cloudflare: the padding
 * happens inside Cloudflare's own runtime, which sees the invocation and its
 * return value. This is metadata hardening against the network, not against the
 * compellable platform. And a long poll is periodic contact with the app
 * domain, which is itself a presence signal that padding says nothing about.
 */
export function padPollResponse(frame: Uint8Array | null, filler: Uint8Array): Uint8Array {
	const out = new Uint8Array(BROKER_FRAME_LEN);
	out.set(filler.subarray(0, BROKER_FRAME_LEN));
	if (frame) out.set(frame.subarray(0, BROKER_FRAME_LEN));
	return out;
}

/**
 * Which tick a moment falls in, on a grid offset per instance.
 *
 * The offset is drawn once in memory per Durable Object and never persisted, so
 * two brokers do not deliver in lockstep and an observer cannot align an
 * external clock to the grid.
 */
export function tickOf(nowMs: number, offsetMs: number): number {
	return Math.floor((nowMs + offsetMs) / TICK_MS);
}
