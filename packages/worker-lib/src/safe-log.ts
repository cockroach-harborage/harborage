/**
 * The only logging path (ARCHITECTURE §10.5). Never log IP, geo, identifiers,
 * tokens, bodies, or full URLs. This governs OUR retention only — platform
 * telemetry exists independently and is compellable.
 *
 * The gate (tools/gates/gate-safelog.mjs) bans raw console.* everywhere else
 * and scans call sites for sensitive field names.
 */

const ALLOWED_KEYS = new Set([
	'event',
	'route', // route TEMPLATE only, e.g. "/api/incident/:id" — never a concrete URL
	'statusClass', // "2xx" | "4xx" | "5xx" — not precise status where it could fingerprint
	'ms', // coarse timing bucket
	'flag',
	'outcome',
	'count',
	'queue',
	'milestone'
]);

type SafeValue = string | number | boolean;

export function safeLog(event: string, fields: Record<string, SafeValue> = {}): void {
	const entry: Record<string, SafeValue> = { event };
	for (const [key, value] of Object.entries(fields)) {
		if (!ALLOWED_KEYS.has(key)) continue; // drop, never throw: logging must not break serving
		entry[key] = typeof value === 'string' ? value.slice(0, 128) : value;
	}
	// eslint-disable-next-line no-console -- the single sanctioned console call
	console.log(JSON.stringify(entry));
}

/** Coarse timing bucket so latency logs cannot become a correlation signal. */
export function coarseMs(ms: number): number {
	if (ms < 50) return 50;
	if (ms < 100) return 100;
	if (ms < 500) return 500;
	if (ms < 1000) return 1000;
	return 5000;
}

export function statusClass(status: number): string {
	return `${Math.floor(status / 100)}xx`;
}
