// Sensitive-write-must-be-sealed harness (ARCHITECTURE §17.5).
//
// Every sensitive endpoint registered here must have a test proving the intake
// worker rejects a non-sealed body. The registry existing (even empty) is itself
// enforced so the gate cannot be silently orphaned.
//
// Three things this gate learned the hard way:
//
// 1. A string-match gate on a load-bearing invariant is worse than no gate. The
//    first version passed if the endpoint name appeared anywhere in a test
//    file — a lone comment satisfied it. It now requires real assertions and a
//    rejection status, and the endpoint must actually exist in a router.
// 2. "Sealed" is not one property. An endpoint whose body a platform-side key
//    can open is NOT end-to-end, and printing a green "sealed body" check over
//    it is an actively misleading claim on a project whose credibility is its
//    honesty. Each entry therefore declares a custody class.
// 3. "The platform holds no key" is a claim about ONE BODY OF CIPHERTEXT, not
//    about the whole deployment. The previous version refused a SEALED-E2E
//    endpoint if any unseal-shaped binding existed anywhere, which made the
//    class unreachable the moment a single SEALED-TO-PLATFORM endpoint had a
//    key — as `/api/incidents/register` does, legitimately and by design. Left
//    that way the only ways forward were to delete the check or to rename the
//    binding until the pattern stopped matching, and both leave a green tick
//    over an invariant nobody is enforcing.
//
//    So custody is now scoped to a SEALED OBJECT: the named body of ciphertext
//    an endpoint accepts. A platform key opens the sealed object of the entry
//    that declares it, and nothing else. A SEALED-E2E entry fails if any key
//    opens ITS sealed object, and — separately — if any unseal-shaped binding
//    is unregistered, because a binding whose scope nobody wrote down has to be
//    assumed to open everything. That second rule is what keeps the relaxation
//    from becoming an escape hatch: the way to make this check pass is still to
//    not hold the key, never to keep quiet about holding it.
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { repoRoot, walk, read, fail } from './lib.mjs';

const registryPath = join(repoRoot, 'tools/gates/sensitive-endpoints.json');
const problems = [];

const CLASSES = ['SEALED-E2E', 'SEALED-TO-PLATFORM'];
// Bindings that mean "this worker can decrypt". Which ciphertext they can
// decrypt is what the sealed_object lane records.
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
/**
 * Where bindings are actually declared: every wrangler config, plus every
 * shared `src/types.ts` Env contract.
 *
 * A secret is set with `wrangler secret put` and appears in no config file, so
 * the Env interface is the one place it must be named to be readable at all.
 * Honest residual: a binding read through an `as any` cast, or declared in some
 * other TypeScript file, is still invisible here. The scan was widened from a
 * single hardcoded path to every `src/types.ts` because the old form would have
 * missed a second Env contract in a new package without saying so.
 */
function bindingFiles() {
	const files = [];
	for (const top of ['workers', 'apps', 'packages']) {
		for (const file of walk(join(repoRoot, top))) {
			const unix = file.replaceAll('\\', '/');
			if (/wrangler\.jsonc$/.test(unix) || /\/src\/types\.ts$/.test(unix)) files.push(file);
		}
	}
	return files;
}

let routerText = '';
for (const file of walk(join(repoRoot, 'workers'))) {
	if (/\.ts$/.test(file) && !/\.(test|spec)\.ts$/.test(file)) routerText += read(file);
}

/**
 * binding -> the set of sealed objects it is registered as able to open.
 * Built before the per-entry pass, because the SEALED-E2E check needs to know
 * every key's scope, not just the keys declared on the entry it is checking.
 */
const declared = new Map();
for (const raw of entries) {
	if (typeof raw !== 'object' || raw === null) continue;
	const key = raw.platform_key;
	if (!key) continue;
	if (!key.binding || !key.why || String(key.why).trim().length < 40) {
		problems.push(
			`${raw.endpoint}: platform_key needs a "binding" and a substantive "why" naming who holds it and why nothing else may`
		);
		continue;
	}
	if (raw.class === 'SEALED-E2E') {
		problems.push(`${raw.endpoint}: a SEALED-E2E endpoint cannot declare a platform_key`);
		continue;
	}
	if (typeof raw.sealed_object !== 'string' || raw.sealed_object.trim() === '') {
		// The lane check below reports the missing field; skip registering a key
		// whose scope would otherwise be recorded as undefined.
		continue;
	}
	if (!declared.has(key.binding)) declared.set(key.binding, new Set());
	declared.get(key.binding).add(raw.sealed_object);
}

/** Every unseal-shaped binding that exists, with the file that declares it. */
function existingUnsealBindings() {
	const found = new Map();
	for (const file of bindingFiles()) {
		for (const m of read(file).matchAll(new RegExp(UNSEAL_SECRET_RE.source, 'g'))) {
			if (!found.has(m[1])) found.set(m[1], relative(repoRoot, file));
		}
	}
	return found;
}
const existing = existingUnsealBindings();

for (const raw of entries) {
	// Structured entries only: a bare string cannot carry a custody class, and
	// silently defaulting one would reintroduce the overclaim this gate exists
	// to prevent.
	if (typeof raw !== 'object' || raw === null) {
		problems.push(
			`registry entry ${JSON.stringify(raw)} must be an object with "endpoint", "class" and "sealed_object"`
		);
		continue;
	}
	const { endpoint, class: cls, sealed_object: lane } = raw;
	if (!endpoint) {
		problems.push(`registry entry ${JSON.stringify(raw)} has no "endpoint"`);
		continue;
	}
	if (!CLASSES.includes(cls)) {
		problems.push(`${endpoint}: "class" must be one of ${CLASSES.join(' | ')}, got ${cls}`);
		continue;
	}
	// Naming the ciphertext is mandatory. There is deliberately no default: a
	// missing lane would have to mean either "opens nothing" or "opens
	// everything", and picking either for the author is how a custody claim
	// becomes accidental.
	if (typeof lane !== 'string' || lane.trim() === '') {
		problems.push(
			`${endpoint}: "sealed_object" must name the body of ciphertext this endpoint accepts, so key custody can be scoped to it`
		);
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

	// "We cannot produce plaintext" must be structurally true for THIS
	// ciphertext. Two ways it can be false: a registered key whose scope
	// includes this lane, or a key nobody scoped at all.
	if (cls === 'SEALED-E2E') {
		for (const [binding, where] of existing) {
			const opens = declared.get(binding);
			if (!opens) {
				problems.push(
					`${endpoint} is declared SEALED-E2E but ${where} declares ${binding}, which is registered to open nothing; an unscoped unseal key must be assumed to open every sealed object`
				);
			} else if (opens.has(lane)) {
				problems.push(
					`${endpoint} is declared SEALED-E2E over "${lane}" but ${where} declares ${binding}, which is registered as opening "${lane}"; a platform-held unseal key contradicts the class`
				);
			}
		}
	}
}

// A SEALED-TO-PLATFORM body is opened by SOME key, and that key must be named
// and justified here rather than hidden behind a binding name picked to slip
// past UNSEAL_SECRET_RE. Without this, the lane check above degrades to
// paperwork: an author could keep a key off the registry and every E2E claim
// would still read green.
for (const [binding, where] of existing) {
	if (!declared.has(binding)) {
		problems.push(
			`${where} declares ${binding}, which is not registered as a platform_key in sensitive-endpoints.json. Register it against the sealed object it opens, with a justification, or it should not exist.`
		);
	}
}

// A declared key that no longer exists anywhere is a stale claim about custody.
for (const binding of declared.keys()) {
	if (!existing.has(binding)) {
		problems.push(
			`platform_key ${binding} is declared but no binding by that name exists; drop the claim or restore the binding`
		);
	}
}

if (fail('gate-sealed-body', problems)) process.exit(1);
const byClass = CLASSES.map((c) => `${entries.filter((e) => e?.class === c).length} ${c}`).join(
	', '
);
const lanes = new Set(entries.map((e) => e?.sealed_object).filter(Boolean));
console.log(
	`gate-sealed-body OK: ${entries.length} sensitive endpoint(s) (${byClass}) across ${lanes.size} sealed object(s)`
);
