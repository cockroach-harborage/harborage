// Onion-only endpoint gate (ARCHITECTURE §9.2; CLAUDE.md §3).
//
// The medical broker and the detainee/incommunicado handshakes refuse over
// clearnet. Two source IPs arriving at one low-volume Durable Object inside the
// jitter window is a strong pairing that sealed-sender cannot hide, so for these
// flows the honest posture is to refuse rather than to serve a weaker version.
//
// WHAT THIS GATE ADDS OVER A UNIT TEST. A route behind an onion guard returns
// 403 to every test that does not forge a valid ingress assertion, and 403 is
// also what the flag check and the credential check return. So a route test can
// assert "not 200" and stay green with the guard deleted. This repo has been
// bitten by exactly that shape three times. Refusing the code's EXISTENCE is the
// only check that cannot be satisfied by an unrelated refusal firing first.
//
// The load-bearing step is handlerBlocks() in lib.mjs. A whole-file
// `text.includes('requireOnionOrigin')` cannot tell a guarded route apart from
// one whose NEIGHBOUR is guarded, so a route could lose its guard entirely while
// the file still read as guarded. fixtures/fail-unguarded/ is exactly that
// shape: if it ever goes green, the block split is broken.
import { join, relative } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { repoRoot, walk, read, fail, handlerBlocks } from './lib.mjs';

const registryPath = join(repoRoot, 'tools/gates/onion-only-endpoints.json');
const GUARD_RE = /\brequireOnionOrigin\s*\(/;
const MIN_WHY = 40;

// Anything that reads a binding or spends real work. requireOnionOrigin must
// come before ALL of these: a clearnet request to a life-safety route must not
// even cause a KV read, because the timing of that read is itself the signal
// that someone in a given colo is trying to reach the medical broker.
//
// A bare `c.env` is deliberately NOT here. requireOnionOrigin takes `c.env` as
// an argument, so matching it would make the rule unsatisfiable. What is matched
// is a METHOD CALL on a binding (`c.env.FLAGS.get(`), which passing a reference
// does not do.
const SIDE_EFFECT_RE =
	/\b(featureAvailable|flagEnabled|credentialOk|oneShotCredentialOk|broadOk|verifyTurnstile|admitCredential|admitOneShot|verifyRequestCredential|verifyInboxToken)\s*\(|\.\s*(prepare|idFromName|batch|withSession)\s*\(|c\.env\.\w+\s*\.\s*\w+\s*\(/;

const problems = [];

if (!existsSync(registryPath)) {
	console.error(`gate-onion-only FAIL: missing ${relative(repoRoot, registryPath)}`);
	process.exit(1);
}
const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
const entries = registry.endpoints ?? [];

// --- Collect handler blocks and covering tests from workers/** ---------------
const blocks = [];
const testTexts = [];
for (const file of walk(join(repoRoot, 'workers'))) {
	if (!file.endsWith('.ts')) continue;
	const rel = relative(repoRoot, file);
	if (/\.onion-only\.(test|spec)\.ts$/.test(file)) {
		testTexts.push({ rel, text: read(file) });
		continue;
	}
	if (/\.(test|spec)\.ts$/.test(file)) continue;
	blocks.push(...handlerBlocks(read(file), rel));
}

/** "POST /api/medical/request" -> { method, path } */
function parseEndpoint(endpoint) {
	const m = /^([A-Z]+)\s+(\/\S*)$/.exec(endpoint);
	return m ? { method: m[1], path: m[2] } : null;
}

const registered = new Set();

for (const raw of entries) {
	if (typeof raw !== 'object' || raw === null) {
		problems.push(`registry entry is not an object: ${JSON.stringify(raw)}`);
		continue;
	}
	const { endpoint, why } = raw;
	const parsed = typeof endpoint === 'string' ? parseEndpoint(endpoint) : null;
	if (!parsed) {
		problems.push(
			`registry entry has no usable "endpoint" (want "POST /api/x/y"): ${JSON.stringify(endpoint)}`
		);
		continue;
	}
	if (typeof why !== 'string' || why.trim().length < MIN_WHY) {
		problems.push(
			`${endpoint} — "why" must be at least ${MIN_WHY} characters saying what pairing or correlation the onion requirement defeats for THIS endpoint. An entry nobody can reread is an entry the next person deletes`
		);
	}
	registered.add(`${parsed.method} ${parsed.path}`);

	// (a) the route exists
	const matching = blocks.filter(
		(b) =>
			b.path === parsed.path &&
			(b.method === parsed.method || b.method === 'ALL' || b.method === 'ON')
	);
	if (matching.length === 0) {
		problems.push(
			`${endpoint} — no handler in workers/** registers this route. A registry entry for a route that does not exist protects nothing and hides the fact that it is gone`
		);
		continue;
	}

	for (const block of matching) {
		// (b) guarded, in THIS handler
		const guard = GUARD_RE.exec(block.text);
		if (!guard) {
			problems.push(
				`${block.file} — the handler for ${endpoint} does not call requireOnionOrigin. A call in a neighbouring handler does not count: that is how a route loses its guard while the file still looks guarded`
			);
			continue;
		}
		// (c) guarded FIRST
		const side = SIDE_EFFECT_RE.exec(block.text);
		if (side && side.index < guard.index) {
			problems.push(
				`${block.file} — the handler for ${endpoint} reaches ${JSON.stringify(side[0].trim())} before requireOnionOrigin. A clearnet request to a life-safety route must not even cause a binding read, because the timing of that read is itself the signal`
			);
		}
	}

	// (d) a test names the endpoint, and proves the refusal
	const covering = testTexts.filter((t) => t.text.includes(endpoint));
	if (covering.length === 0) {
		problems.push(
			`${endpoint} — no workers/**/*.onion-only.test.ts names this endpoint. Add one that posts a well-formed body with no ingress assertion and asserts the 403`
		);
		continue;
	}
	const joined = covering.map((t) => t.text).join('\n');
	const asserts = (joined.match(/\bexpect\s*\(/g) ?? []).length;
	if (asserts < 2) {
		problems.push(
			`${endpoint} — its onion-only test has ${asserts} expect() call(s). One assertion cannot distinguish "refused for the right reason" from "refused for any reason"`
		);
	}
	if (!/\b403\b/.test(joined)) {
		problems.push(
			`${endpoint} — its onion-only test never asserts 403. Assert the exact status: a 401 from the credential check or a 403 from the flag would otherwise pass for the guard`
		);
	}
}

// --- The inverse rule --------------------------------------------------------
// Every guarded handler must be registered. Without this the gate is vacuous
// while the registry is empty, and the first onion-only route could ship
// unregistered while the gate reported success over an endpoint it never saw.
for (const block of blocks) {
	if (!GUARD_RE.test(block.text)) continue;
	if (!registered.has(`${block.method} ${block.path}`)) {
		problems.push(
			`${block.file} — the handler for ${block.method} ${block.path} calls requireOnionOrigin but is not listed in tools/gates/onion-only-endpoints.json. An unregistered guard is a guard with no test requirement and no recorded reason`
		);
	}
}

if (fail('gate-onion-only', problems)) process.exit(1);
const guarded = blocks.filter((b) => GUARD_RE.test(b.text)).length;
console.log(
	`gate-onion-only OK: ${entries.length} registered endpoint(s), ${guarded} guarded handler(s), ${blocks.length} handler(s) scanned`
);
