// Geo-granularity gate (RED LINE 3: no live individual location, no persistent
// who-was-where log; ARCHITECTURE §6.3, §6.4; PRD §4.5).
//
// The live board is the feature most able to get someone kettled or arrested, and
// the way it goes wrong is not a bad decision but a small convenience: a
// `lat`/`lng` column added "for later", a geohash-7 because it looked more
// useful, a `getCurrentPosition()` behind a "find my area" button. Each is one
// line, each typechecks, and none breaks a test.
//
// ONE REAL HOLE THIS CLOSES TODAY, before any M5 code exists: Cloudflare hands
// every Worker `request.cf.latitude` and `.longitude`, and nothing in the
// eighteen gates stopped a Worker reading them. That is not hypothetical
// tightening; it was reachable.
//
// Check 4 compares DIRECTIONS, not values. `expect(DENSITY_FLOOR_D).toBe(5)` is a
// test that whoever lowers the floor edits in the same commit. A direction-aware
// comparison means tightening always passes and loosening never does.
import { join, relative } from 'node:path';
import { existsSync } from 'node:fs';
import { repoRoot, walk, read, fail, stripComments } from './lib.mjs';

const problems = [];

// --- 1. No client geolocation ------------------------------------------------
// Comments stripped: these are about what the code DOES, and a comment saying
// "we never call getCurrentPosition" must not trip the rule.
const CLIENT_GEO = [
	[/navigator\s*\.\s*geolocation/, 'navigator.geolocation'],
	[/\bgetCurrentPosition\s*\(/, 'getCurrentPosition()'],
	[/\bwatchPosition\s*\(/, 'watchPosition()'],
	[/\bGeolocationCoordinates\b/, 'GeolocationCoordinates'],
	[/\bGeolocationPosition\b/, 'GeolocationPosition'],
	[/\bPositionOptions\b/, 'PositionOptions']
];
let clientFiles = 0;
for (const app of ['web', 'console']) {
	for (const file of walk(join(repoRoot, 'apps', app, 'src'))) {
		if (!/\.(ts|js|svelte)$/.test(file)) continue;
		clientFiles++;
		const code = stripComments(read(file));
		for (const [re, what] of CLIENT_GEO) {
			if (re.test(code))
				problems.push(
					`${relative(repoRoot, file)} — uses ${what}. There is no self-location primitive on this platform: a zone is chosen from a signed list, never derived from where the device is`
				);
		}
	}
}

// --- 1b. No server-side coordinate, either -----------------------------------
// THE HOLE. Cloudflare attaches a lat/lng to every request; reading one is a
// precise position the platform then holds, however briefly, and whatever it is
// used for. `request.cf.asn` is used deliberately for rate-limit sharding and is
// not a position, so it stays.
const SERVER_GEO = [
	[/\bcf\s*(\?\.|\.)\s*latitude\b/, 'request.cf.latitude'],
	[/\bcf\s*(\?\.|\.)\s*longitude\b/, 'request.cf.longitude'],
	[/\bcf\s*(\?\.|\.)\s*postalCode\b/, 'request.cf.postalCode'],
	[/\bcf\s*(\?\.|\.)\s*city\b/, 'request.cf.city'],
	[/\bcf\s*(\?\.|\.)\s*metroCode\b/, 'request.cf.metroCode'],
	[/\bcf\s*(\?\.|\.)\s*timezone\b/, 'request.cf.timezone']
];
let serverFiles = 0;
for (const file of walk(join(repoRoot, 'workers'))) {
	if (!/\.ts$/.test(file) || /\.(test|spec)\.ts$/.test(file)) continue;
	serverFiles++;
	const code = stripComments(read(file));
	for (const [re, what] of SERVER_GEO) {
		if (re.test(code))
			problems.push(
				`${relative(repoRoot, file)} — reads ${what}. Cloudflare offers a precise position on every request and the platform must not take it. request.cf.asn is different: it is not a position, and it shards the rate limiter`
			);
	}
}

// --- 1c. The browser-level ban must stay in place ----------------------------
// A REQUIRED PRESENCE, not an absence. Check 1 stops the code calling the API;
// this stops the header that denies the API being quietly dropped, which is the
// half that also covers injected script.
const hooksPath = join(repoRoot, 'apps/web/src/hooks.server.ts');
if (!existsSync(hooksPath)) {
	problems.push(
		'apps/web/src/hooks.server.ts is missing; the Permissions-Policy cannot be checked'
	);
} else if (!/Permissions-Policy[\s\S]{0,200}geolocation=\(\)/.test(read(hooksPath))) {
	problems.push(
		'apps/web/src/hooks.server.ts — Permissions-Policy must keep geolocation=(). Denying the API at the browser is what also covers injected script, which a source ban cannot'
	);
}

// --- 2. No coordinate columns ------------------------------------------------
// Column-name ANCHORED, not substring: `latency_ms` and `translation` must not
// false-fire, or the gate gets weakened by whoever hits it.
const COORD_COL =
	/^(lat|lng|lon|latitude|longitude|coord|coords|coordinates|gps|gps_lat|gps_lng|geo_point|point|position|accuracy_m|altitude|bearing|speed)$/i;
let migrations = 0;
for (const file of walk(join(repoRoot, 'migrations'))) {
	if (!file.endsWith('.sql')) continue;
	migrations++;
	const sql = read(file);
	const rel = relative(repoRoot, file);
	for (const m of sql.matchAll(
		/create\s+table\s+(?:if\s+not\s+exists\s+)?["'`]?(\w+)["'`]?\s*\(([\s\S]*?)\);/gi
	)) {
		for (const rawLine of m[2].split('\n')) {
			const line = rawLine.replace(/--.*$/, '').trim();
			if (!line) continue;
			const col = /^["'`]?(\w+)["'`]?\s+\w+/.exec(line);
			if (!col) continue;
			const name = col[1];
			if (['primary', 'foreign', 'unique', 'check', 'constraint'].includes(name.toLowerCase()))
				continue;
			if (COORD_COL.test(name))
				problems.push(
					`${rel} — ${m[1]}.${name} is a coordinate column. Red line 3 forbids a persistent queryable position anywhere, and a column that can hold one is a column a later query will`
				);
			if (/^gps/i.test(name) || /^precise_/i.test(name))
				problems.push(`${rel} — ${m[1]}.${name} is named for precision the schema must not carry`);
		}
	}
}

// --- 3. No geohash finer than 6 ----------------------------------------------
// Conservative, like gate-d1-index: only high-confidence patterns, because a
// false failure gets a gate deleted and a missed case is a review item.
const GEOHASH_PATTERNS = [
	/\bgeohash[_-]?(\d+)\b/gi,
	/\bcoarse_geohash(\d+)\b/gi,
	/GEOHASH_PRECISION\s*=\s*(\d+)/g,
	/geohash[^;\n]{0,40}?precision\s*[:=]\s*(\d+)/gi
];
const MAX_PRECISION = 6;
let scanned = 0;
for (const top of ['apps', 'workers', 'packages', 'migrations']) {
	for (const file of walk(join(repoRoot, top))) {
		if (!/\.(ts|js|svelte|sql|json)$/.test(file)) continue;
		scanned++;
		const text = read(file);
		for (const re of GEOHASH_PATTERNS) {
			for (const m of text.matchAll(re)) {
				const n = Number.parseInt(m[1], 10);
				if (Number.isFinite(n) && n > MAX_PRECISION)
					problems.push(
						`${relative(repoRoot, file)} — geohash precision ${n} in ${JSON.stringify(m[0])}. Never finer than ${MAX_PRECISION} (about 1.2 km by 0.6 km): finer is a position, and a position is red line 3`
					);
			}
		}
	}
}

// --- 4. The §6.4 constants are pinned, direction-aware -----------------------
const paramsPath = join(repoRoot, 'packages/worker-lib/src/liveboard/params.ts');
if (!existsSync(paramsPath)) {
	problems.push(
		'packages/worker-lib/src/liveboard/params.ts is missing; the §6.4 safety parameters must live in one file so they can be pinned'
	);
} else {
	const text = read(paramsPath);
	/** A numeric literal, with underscore separators and simple products resolved. */
	function value(name) {
		const m = new RegExp(`export const ${name}\\s*=\\s*([0-9_*\\s]+)`).exec(text);
		if (!m) return null;
		const parts = m[1]
			.replaceAll('_', '')
			.split('*')
			.map((p) => Number.parseInt(p.trim(), 10));
		if (parts.some((p) => !Number.isFinite(p))) return null;
		return parts.reduce((a, b) => a * b, 1);
	}
	/** [name, comparator, bound, why tightening is the safe direction] */
	const PINS = [
		['MAX_GEOHASH_PRECISION', '===', 6, 'finer is a position; coarser would break the zone list'],
		['DENSITY_FLOOR_D', '>=', 5, 'a lower floor publishes a smaller group'],
		['CORROBORATION_K', '>=', 3, 'a lower bar publishes a single unverified report'],
		['PUBLICATION_DELAY_BASE_MS', '>=', 60_000, 'a shorter delay is closer to live'],
		['PUBLICATION_JITTER_MAX_MS', '>=', 120_000, 'less jitter narrows the report-time window'],
		['SIGNAL_TTL_MS', '<=', 900_000, 'a longer TTL is a longer-lived record'],
		['DEDUP_EPOCH_MS', '<=', 900_000, 'a longer epoch links more reports to one reporter'],
		['MARSHAL_QUORUM_M', '>=', 2, 'one signature is one seized key'],
		['MARSHAL_QUORUM_MIN_KEYS', '>=', 3, 'a two-key directory satisfies m without satisfying n'],
		['TICK_MS', '>=', 30_000, 'a finer tick is a finer timestamp'],
		['REBUILD_TICKS', '>=', 1, 'without a rebuilding window the board flashes empty after eviction']
	];
	for (const [name, op, bound, why] of PINS) {
		const v = value(name);
		if (v === null) {
			problems.push(`params.ts — ${name} is missing or not a plain numeric literal`);
			continue;
		}
		const ok = op === '===' ? v === bound : op === '>=' ? v >= bound : v <= bound;
		if (!ok)
			problems.push(
				`params.ts — ${name} is ${v}, which must be ${op} ${bound}. Tightening is always allowed; loosening is not, because ${why}`
			);
	}
	// Five band words, none of them a number, so no read path can render a count.
	const bands = /export const BANDS\s*=\s*\[([^\]]*)\]/.exec(text);
	if (!bands) problems.push('params.ts — BANDS is missing');
	else {
		const values = [...bands[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
		if (values.length !== 5)
			problems.push(`params.ts — BANDS has ${values.length} entries; §6.4 specifies five`);
		for (const v of values)
			if (/\d/.test(v))
				problems.push(
					`params.ts — band ${JSON.stringify(v)} contains a digit. A band that looks like a number is a count with extra steps`
				);
	}
	// The floor must live here and nowhere else, or two copies drift.
	for (const top of ['apps', 'workers', 'packages']) {
		for (const file of walk(join(repoRoot, top))) {
			if (!/\.ts$/.test(file) || file === paramsPath) continue;
			if (/\.(test|spec)\.ts$/.test(file)) continue;
			if (/(const|let|var)\s+DENSITY_FLOOR\w*\s*=/.test(stripComments(read(file))))
				problems.push(
					`${relative(repoRoot, file)} — declares its own density floor. There must be exactly one, in params.ts, or the pinned copy stops being the one that runs`
				);
		}
	}
}

if (fail('gate-geo-granularity', problems)) process.exit(1);
console.log(
	`gate-geo-granularity OK: ${clientFiles} client file(s) with no self-location, ${serverFiles} worker file(s) taking no coordinate, ${migrations} migration(s) with no position column, ${scanned} file(s) at geohash-${MAX_PRECISION} or coarser, §6.4 parameters pinned`
);
