// Gate self-test (CLAUDE.md: "negative-test every new gate — a gate that cannot
// fail is worse than no gate, and this repo has shipped two of those").
//
// Every gate-*.mjs must come with a fixture pair under fixtures/<gate>/:
//   pass/  a minimal tree the gate accepts   -> the gate must exit 0
//   fail/  the same tree with ONE invariant broken -> the gate must exit non-zero
//
// The gates read their tree through `repoRoot` in lib.mjs, so pointing
// HARBORAGE_GATE_ROOT at a fixture runs the real gate against fake sources with
// no mocking and no second implementation to drift.
//
// A gate with no fixture directory FAILS here, so a new gate cannot land
// untested. Deleting a fixture to "fix" a red build re-opens the hole this
// closes: fix the gate or the fixture, never the harness.
import { readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const self = 'gate-selftest.mjs';

// Nested invocation would recurse forever. Running the harness against a fixture
// is never meaningful, so refuse rather than pretend to pass.
if (process.env.HARBORAGE_GATE_ROOT) {
	console.error('gate-selftest FAIL: refusing to run inside a fixture root');
	process.exit(1);
}

const gates = readdirSync(here)
	.filter((f) => f.startsWith('gate-') && f.endsWith('.mjs') && f !== self)
	.sort();

/** Run one gate against one fixture tree. Returns its exit status. */
function runAgainst(gate, root) {
	const res = spawnSync(process.execPath, [join(here, gate)], {
		env: { ...process.env, HARBORAGE_GATE_ROOT: root },
		encoding: 'utf8'
	});
	return { status: res.status, out: `${res.stdout ?? ''}${res.stderr ?? ''}`.trim() };
}

const problems = [];
let checked = 0;
for (const gate of gates) {
	const name = gate.replace(/\.mjs$/, '');
	const dir = join(here, 'fixtures', name);
	const passDir = join(dir, 'pass');
	const failDir = join(dir, 'fail');

	if (!existsSync(passDir) || !existsSync(failDir)) {
		problems.push(
			`${name}: missing fixtures — create tools/gates/fixtures/${name}/{pass,fail}/ so the gate is proven able to fail`
		);
		continue;
	}

	const pass = runAgainst(gate, passDir);
	if (pass.status !== 0) {
		problems.push(
			`${name}: rejected its own PASS fixture (exit ${pass.status}). The fixture is stale or the gate got stricter.\n    ${pass.out.replaceAll('\n', '\n    ')}`
		);
	}

	const bad = runAgainst(gate, failDir);
	if (bad.status === 0) {
		problems.push(
			`${name}: ACCEPTED its FAIL fixture. The gate cannot detect the very thing it exists to catch.`
		);
	}
	checked++;
}

if (problems.length > 0) {
	for (const p of problems) console.error(`gate-selftest FAIL: ${p}`);
	process.exit(1);
}
console.log(`gate-selftest OK: ${checked} gate(s) proven to pass clean input and reject broken input`);
