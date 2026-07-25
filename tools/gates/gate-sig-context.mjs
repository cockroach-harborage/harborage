// Domain-separation gate (ARCHITECTURE §17.6).
//
// One compartment key signs several protocols (cap-cert, per-request PoP,
// corroboration, directory report). If any of them signs raw bytes, a captured
// signature can be lifted from one protocol into another. packages/crypto's
// sign()/verify() take a mandatory SigContext and frame it length-first, so the
// only way to reintroduce the hazard is to reach past them to the curve.
//
// This gate checks the two things TypeScript cannot:
//   1. Nobody calls a curve's .sign() directly outside the frozen module.
//   2. The SIG_CONTEXT registry stays `as const` (without it the literal union
//      widens to `string` and the type system stops rejecting ad-hoc tags),
//      with unique, prefixed, versioned values. Two protocols sharing a tag is
//      exactly the confusion the framing exists to prevent, and it typechecks
//      perfectly.
import { join, relative } from 'node:path';
import { repoRoot, walk, read, fail } from './lib.mjs';

// Where signing legitimately lives. Everything else must go through sign().
const FROZEN = 'packages/crypto/src/';
const REGISTRY = 'packages/crypto/src/compartments.ts';
const ALLOWED = [/\.test\.ts$/, /\.spec\.ts$/];

const RAW_SIGN_RE =
	/\b(ed25519(?:ctx|ph)?|x25519|p256|p384|p521|secp256k1|schnorr)\s*\.\s*sign\s*\(/;

const problems = [];
let scanned = 0;
for (const top of ['apps', 'workers', 'packages']) {
	for (const file of walk(join(repoRoot, top))) {
		if (!/\.(ts|js|svelte)$/.test(file)) continue;
		const rel = relative(repoRoot, file).replaceAll('\\', '/');
		if (rel.startsWith(FROZEN)) continue;
		if (ALLOWED.some((re) => re.test(rel))) continue;
		scanned++;
		const m = read(file).match(RAW_SIGN_RE);
		if (m) {
			const text = read(file);
			const line = text.slice(0, text.indexOf(m[0])).split('\n').length;
			problems.push(
				`${rel}:${line} — ${m[0]} bypasses domain separation; use sign(SIG_CONTEXT.x, ...) from @harborage/crypto`
			);
		}
	}
}

const registryPath = join(repoRoot, REGISTRY);
let registry = '';
try {
	registry = read(registryPath);
} catch {
	problems.push(`${REGISTRY} is missing (the signing-context registry must exist)`);
}

if (registry) {
	const block = /export\s+const\s+SIG_CONTEXT\s*=\s*\{([\s\S]*?)\}\s*as\s+const\s*;/.exec(registry);
	if (!block) {
		problems.push(
			`${REGISTRY}: SIG_CONTEXT must be declared as an object literal ending in "} as const;" — without "as const" the value type widens to string and ad-hoc tags typecheck`
		);
	} else {
		const values = [...block[1].matchAll(/:\s*'([^']*)'/g)].map((m) => m[1]);
		if (values.length === 0) problems.push(`${REGISTRY}: SIG_CONTEXT has no entries`);
		const seen = new Set();
		for (const v of values) {
			if (seen.has(v)) problems.push(`${REGISTRY}: duplicate signing context ${JSON.stringify(v)}`);
			seen.add(v);
			if (!v.startsWith('harborage/sig/'))
				problems.push(`${REGISTRY}: ${JSON.stringify(v)} must start with "harborage/sig/"`);
			if (!/\/v\d+$/.test(v))
				problems.push(
					`${REGISTRY}: ${JSON.stringify(v)} must end in a version suffix, so a format change can mint a new tag instead of silently reusing one`
				);
		}
	}
}

if (fail('gate-sig-context', problems)) process.exit(1);
console.log(`gate-sig-context OK: ${scanned} file(s), no raw curve signing outside the frozen module`);
