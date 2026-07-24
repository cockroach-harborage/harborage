// Sensitive-write-must-be-sealed harness (ARCHITECTURE §17.5).
//
// Every sensitive endpoint registered here must have a test proving the intake
// worker rejects a non-sealed body. The registry existing (even empty) is itself
// enforced so the gate cannot be silently orphaned.
//
// Two things this gate learned the hard way:
//
// 1. A string-match gate on a load-bearing invariant is worse than no gate. The
//    previous version passed if the endpoint name appeared anywhere in a test
//    file — a lone comment satisfied it. It now requires real assertions and a
//    rejection status, and the endpoint must actually exist in a router.
// 2. "Sealed" is not one property. An endpoint whose body a platform-side key
//    can open is NOT end-to-end, and printing a green "sealed body" check over
//    it is an actively misleading claim on a project whose credibility is its
//    honesty. Each entry therefore declares a custody class, and SEALED-E2E is
//    refused if any worker holds an unseal secret.
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { repoRoot, walk, read, fail } from './lib.mjs';

const registryPath = join(repoRoot, 'tools/gates/sensitive-endpoints.json');
const problems = [];

const CLASSES = ['SEALED-E2E', 'SEALED-TO-PLATFORM'];
// Bindings that mean "this worker can decrypt". Their presence is incompatible
// with a SEALED-E2E claim anywhere in the same deployment.
const UNSEAL_SECRET_RE = /"?\b([A-Z0-9_]*(UNSEAL|PRIVATE_KEY|SECRET_KEY|DECRYPT)[A-Z0-9_]*)\b"?/;

if (!existsSync(registryPath)) {
	problems.push('tools/gates/sensitive-endpoints.json is missing');
	fail('gate-sealed-body', problems);
	process.exit(1);
}

const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
const entries = registry.endpoints ?? [];

// Collect the sealed-body tests and the router sources once.
const testFiles = [];
for (const file of walk(join(repoRoot, 'workers'))) {
	if (/sealed-body\.(test|spec)\.ts$/.test(file)) testFiles.push(file);
}
let routerText = '';
for (const file of walk(join(repoRoot, 'workers'))) {
	if (/\.ts$/.test(file) && !/\.(test|spec)\.ts$/.test(file)) routerText += read(file);
}

for (const raw of entries) {
	// Structured entries only: a bare string cannot carry a custody class, and
	// silently defaulting one would reintroduce the overclaim this gate exists
	// to prevent.
	if (typeof raw !== 'object' || raw === null) {
		problems.push(
			`registry entry ${JSON.stringify(raw)} must be an object with "endpoint" and "class"`
		);
		continue;
	}
	const { endpoint, class: cls } = raw;
	if (!endpoint) {
		problems.push(`registry entry ${JSON.stringify(raw)} has no "endpoint"`);
		continue;
	}
	if (!CLASSES.includes(cls)) {
		problems.push(`${endpoint}: "class" must be one of ${CLASSES.join(' | ')}, got ${cls}`);
		continue;
	}

	// The endpoint must actually be routed, so a stale registry entry cannot
	// keep the gate green after the handler is renamed or removed.
	const path = endpoint.replace(/^[A-Z]+\s+/, '');
	if (!routerText.includes(path)) {
		problems.push(`${endpoint}: no route in workers/** matches ${path}`);
	}

	const covering = testFiles.filter((f) => read(f).includes(endpoint));
	if (covering.length === 0) {
		problems.push(`${endpoint}: no sealed-body rejection test names this endpoint`);
		continue;
	}

	// A real rejection test, not a comment: it must assert, and it must assert a
	// 4xx. The reference test proves 415 for the wrong content-type and 400 for
	// octet-stream without the framing magic.
	const text = covering.map(read).join('\n');
	const assertions = (text.match(/\bexpect\s*\(/g) ?? []).length;
	if (assertions < 2) {
		problems.push(`${endpoint}: sealed-body test needs at least 2 assertions, found ${assertions}`);
	}
	if (!/\b4\d{2}\b/.test(text)) {
		problems.push(`${endpoint}: sealed-body test asserts no 4xx rejection status`);
	}

	// "We cannot produce plaintext" must be structurally true, not aspirational.
	// Scan every wrangler config AND the shared Env contract in packages/worker-lib,
	// which is where bindings are actually declared — checking only workers/ would
	// miss the one file that names every secret.
	if (cls === 'SEALED-E2E') {
		const bindingFiles = [];
		for (const top of ['workers', 'apps', 'packages']) {
			for (const file of walk(join(repoRoot, top))) {
				if (/wrangler\.jsonc$/.test(file) || /worker-lib\/src\/types\.ts$/.test(file))
					bindingFiles.push(file);
			}
		}
		for (const file of bindingFiles) {
			const m = read(file).match(UNSEAL_SECRET_RE);
			if (m) {
				problems.push(
					`${endpoint} is declared SEALED-E2E but ${relative(repoRoot, file)} declares ${m[1]}; a platform-held unseal key contradicts the class`
				);
			}
		}
	}
}

if (fail('gate-sealed-body', problems)) process.exit(1);
const byClass = CLASSES.map((c) => `${entries.filter((e) => e?.class === c).length} ${c}`).join(
	', '
);
console.log(`gate-sealed-body OK: ${entries.length} sensitive endpoint(s) (${byClass})`);
