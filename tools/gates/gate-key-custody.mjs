// Key-custody gate (CLAUDE.md §2, §3; ARCHITECTURE §5.1).
//
// WHAT A SEIZED PHONE MUST NOT CONTAIN. A long-lived `medical` or `aid` key in
// IndexedDB is, to anyone holding the phone, a durable statement that its owner
// used the brokered channels, and it links every request that key ever signed.
// The one-shot design exists so no such key is ever written. This gate is what
// keeps it that way.
//
// WHY A GATE AND NOT A TEST. The honest behavioural test is "make an account,
// read IndexedDB, find no aid key". apps/web has no fake-indexeddb, so that
// belongs in Playwright and arrives with the aid surfaces. Meanwhile the actual
// risk is a ONE-WORD edit in identity.ts, from CACHED_COMPARTMENTS back to
// ACTIVE_COMPARTMENTS, which typechecks, breaks no existing test, and silently
// installs a medical key on every device at account creation. M4 nearly shipped
// exactly that, because the obvious reading of "widen ACTIVE_COMPARTMENTS" is a
// single line and installTree iterated the same constant.
//
// A source assertion in vitest was the first attempt and is not available:
// apps/web's tsconfig carries no node types, so a test importing `node:fs` runs
// under vitest and then fails svelte-check. Static source checks belong in a
// .mjs gate. (Found the hard way, again: `pnpm test` was green and `pnpm
// typecheck` was not. Check exit codes, never one command's output.)
import { join, relative } from 'node:path';
import { existsSync } from 'node:fs';
import { repoRoot, read, fail } from './lib.mjs';

/** Strip comments so a doc comment naming a constant cannot satisfy a check. */
function code(text) {
	return text.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/(^|[^:])\/\/.*$/gm, '$1');
}

const files = {
	compartments: 'packages/crypto/src/compartments.ts',
	identity: 'apps/web/src/lib/identity.ts',
	credential: 'apps/web/src/lib/credential.ts',
	core: 'apps/web/src/lib/credential-core.ts'
};

const problems = [];
const src = {};
for (const [key, rel] of Object.entries(files)) {
	const abs = join(repoRoot, rel);
	if (!existsSync(abs)) {
		problems.push(`${rel} — missing; the key-custody invariant cannot be checked without it`);
		continue;
	}
	src[key] = code(read(abs));
}

/** Pull a `readonly Compartment[]` literal out of compartments.ts. */
function listOf(name) {
	const m = new RegExp(
		String.raw`export const ${name}\s*:\s*readonly Compartment\[\]\s*=\s*\[([^\]]*)\]`
	).exec(src.compartments ?? '');
	if (!m) return null;
	return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

if (src.compartments) {
	const active = listOf('ACTIVE_COMPARTMENTS');
	const cached = listOf('CACHED_COMPARTMENTS');
	const oneShot = listOf('ONE_SHOT_ONLY_COMPARTMENTS');

	if (!active || !cached || !oneShot) {
		problems.push(
			`${files.compartments} — ACTIVE_COMPARTMENTS, CACHED_COMPARTMENTS and ONE_SHOT_ONLY_COMPARTMENTS must all exist as readonly Compartment[] literals. They answer three different questions and collapsing them is the bug this gate exists to catch`
		);
	} else {
		// 1. Disjoint. A compartment in both lists is stored on the device AND
		//    claimed to be one-shot: the worst of both, a durable key plus a
		//    statement that there is not one.
		for (const c of cached)
			if (oneShot.includes(c))
				problems.push(
					`${files.compartments} — ${JSON.stringify(c)} is in CACHED_COMPARTMENTS and ONE_SHOT_ONLY_COMPARTMENTS. A stored key cannot also be a one-shot key`
				);
		// 2. Both inside active, and together covering it. An active compartment
		//    in neither list has no defined key custody at all.
		for (const c of [...cached, ...oneShot])
			if (!active.includes(c))
				problems.push(
					`${files.compartments} — ${JSON.stringify(c)} has key custody but the server will not accept a certificate for it`
				);
		for (const c of active)
			if (!cached.includes(c) && !oneShot.includes(c))
				problems.push(
					`${files.compartments} — ${JSON.stringify(c)} is active but appears in neither CACHED_COMPARTMENTS nor ONE_SHOT_ONLY_COMPARTMENTS, so nothing says whether a device may store a key for it`
				);
	}
}

// 3. Account creation derives from the cached list, and cannot reach the active
//    one at all. Checking for the absence of the identifier, not merely for the
//    presence of the right loop, is what stops a second loop being added later.
if (src.identity) {
	if (!/for \(const compartment of CACHED_COMPARTMENTS\)/.test(src.identity))
		problems.push(
			`${files.identity} — account creation must iterate CACHED_COMPARTMENTS. Iterating the server's active list installs a durable brokered key on every device, including the majority that never use the broker`
		);
	if (/\bACTIVE_COMPARTMENTS\b/.test(src.identity))
		problems.push(
			`${files.identity} — must not reference ACTIVE_COMPARTMENTS at all. It is the server's list of what it will accept, not a list of what this device may store`
		);
}

// 4. The certificate cache refuses a brokered compartment. The server would
//    reject it anyway, but only after the linkable certificate had been built
//    and sent, so the refusal belongs on both sides.
if (
	src.credential &&
	!/ONE_SHOT_ONLY_COMPARTMENTS\.includes\([^)]*\)[\s\S]{0,160}throw/.test(src.credential)
)
	problems.push(
		`${files.credential} — the certificate cache must refuse a one-shot-only compartment before minting. Without it a caller reaches the cache by habit and mints an hour-long reusable credential for the broker`
	);

// 5. The one-shot minter has no persistence in scope. Structural on purpose: a
//    module that cannot name a store cannot write to one by accident later.
if (src.core) {
	for (const forbidden of [
		'localStorage',
		'sessionStorage',
		'indexedDB',
		'openDB',
		'document.cookie',
		'$lib/identity',
		'fetch('
	]) {
		if (src.core.includes(forbidden))
			problems.push(
				`${relative('.', files.core)} — references ${JSON.stringify(forbidden)}. The one-shot minter must have no way to persist or transmit anything; that is what makes "writes nothing" a property of its shape rather than of its behaviour`
			);
	}
}

if (fail('gate-key-custody', problems)) process.exit(1);
console.log(
	'gate-key-custody OK: cached and one-shot compartments are disjoint, account creation stores no brokered key, and the one-shot minter can persist nothing'
);
