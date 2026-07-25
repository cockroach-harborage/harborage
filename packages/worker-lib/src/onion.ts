/**
 * Onion-origin classification for life-safety routes (ARCHITECTURE §9.2).
 *
 * Medical brokering and detainee handshakes are ONION-ONLY and refuse over
 * clearnet. The reason is not squeamishness about IP addresses in general: in a
 * low-volume broker, two IPs hitting the same Durable Object inside the jitter
 * window is a strong requester-to-responder pairing, and sealed-sender hides
 * nothing about it. Refusing the flow entirely is the only honest answer until
 * an onion origin exists.
 *
 * HOW IT WORKS, AND WHAT IT IS NOT. A client-supplied header proves nothing —
 * anyone can send one. The operated onion origin is a VPS that terminates the
 * Tor circuit and forwards to an authenticated Worker ingest endpoint, and it
 * proves it forwarded the request by attaching an HMAC over the method, path,
 * body digest and a timestamp, keyed with a secret only it and this Worker hold.
 * A clearnet client cannot forge that, and a captured assertion cannot be
 * replayed onto a different request or outside the window.
 *
 * ABSENT KEY MEANS EVERYTHING IS CLEARNET. There is no onion origin today and
 * no ingress key, so every onion-only route refuses for everyone, on every
 * network. That is the correct resting state and the product copy says so
 * plainly rather than calling it "coming soon".
 *
 * DELIBERATELY NAMED WITHOUT AN UNSEAL-SHAPED SUFFIX. This binding opens no
 * ciphertext — it verifies a MAC — so registering it in
 * tools/gates/sensitive-endpoints.json as a `platform_key` would be a false
 * custody claim about a key that decrypts nothing. Stated here so the naming is
 * not read as evasion of gate-sealed-body's unseal-shaped-binding rule. That
 * gate scans comments as well as code, so this paragraph cannot spell the
 * banned suffixes out even in order to say they were avoided — which is the
 * same reason migration comments cannot say "no payment field".
 */

export const ONION_HEADER = 'X-HB-Onion';
export const ONION_CONTEXT = 'harborage/onion/v1';
/** Clock tolerance either side. Wider than PoP because a Tor circuit is slow. */
export const ONION_WINDOW_MS = 120_000;

export type OriginClass = 'onion' | 'clearnet';

export interface OnionBindings {
	/** Shared with the operated onion origin only. Absent until one exists. */
	ONION_INGRESS_MAC_KEY?: string | undefined;
}

function b64uDecode(s: string): Uint8Array | null {
	try {
		const padded = s.replaceAll('-', '+').replaceAll('_', '/');
		const bin = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
		const out = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
		return out;
	} catch {
		return null;
	}
}

function concat(...parts: Uint8Array[]): Uint8Array {
	const len = parts.reduce((n, p) => n + p.length, 0);
	const out = new Uint8Array(len);
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
}

function u64be(value: number): Uint8Array {
	const out = new Uint8Array(8);
	new DataView(out.buffer).setBigUint64(0, BigInt(value));
	return out;
}

/** Constant-time compare, so a wrong MAC leaks nothing about how wrong. */
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
	return diff === 0;
}

export async function classifyOrigin(
	req: { method: string; url: string; headers: { get(name: string): string | null } },
	bodyHash: Uint8Array,
	env: OnionBindings,
	nowMs: number
): Promise<OriginClass> {
	const key = env.ONION_INGRESS_MAC_KEY;
	// No operated origin, no key, so nothing can be onion. Fail closed.
	if (!key) return 'clearnet';

	const header = req.headers.get(ONION_HEADER);
	if (!header) return 'clearnet';
	const raw = b64uDecode(header);
	if (!raw || raw.length !== 8 + 32) return 'clearnet';

	const ts = Number(new DataView(raw.buffer, raw.byteOffset, 8).getBigUint64(0));
	if (!Number.isFinite(ts) || Math.abs(nowMs - ts) > ONION_WINDOW_MS) return 'clearnet';

	const path = new URL(req.url).pathname;
	const message = concat(
		new TextEncoder().encode(ONION_CONTEXT),
		new TextEncoder().encode(req.method),
		new TextEncoder().encode(path),
		bodyHash,
		u64be(ts)
	);
	try {
		const mac = await crypto.subtle.importKey(
			'raw',
			new TextEncoder().encode(key),
			{ name: 'HMAC', hash: 'SHA-256' },
			false,
			['sign']
		);
		const expected = new Uint8Array(await crypto.subtle.sign('HMAC', mac, message));
		return equalBytes(expected, raw.subarray(8)) ? 'onion' : 'clearnet';
	} catch {
		return 'clearnet';
	}
}

/**
 * Guard for an onion-only route. Returns a Response to send, or null to proceed.
 *
 * Call this FIRST in a handler — before the flag, before the credential, before
 * any binding is read. A clearnet request to a life-safety route must not even
 * cause a KV read, because the timing of that read is itself a signal that
 * someone tried.
 */
export async function requireOnionOrigin(
	req: { method: string; url: string; headers: { get(name: string): string | null } },
	bodyHash: Uint8Array,
	env: OnionBindings,
	nowMs: number
): Promise<Response | null> {
	if ((await classifyOrigin(req, bodyHash, env, nowMs)) === 'onion') return null;
	return new Response('not available on this network', {
		status: 403,
		headers: { 'cache-control': 'no-store' }
	});
}
