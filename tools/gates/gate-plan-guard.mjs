// Proves the destroy guard actually detects a destroy.
//
// The guard only ever runs against a live plan in the deploy workflow, so
// without this it would be a script nobody had seen fail — the same hole
// gate-selftest.mjs exists to close for the other gates.
//
// Fixtures under tools/plan-guard/fixtures/ are named by their expectation:
//   *.clean.json    the guard must accept   (exit 0)
//   *.destroy.json  the guard must refuse   (exit non-zero)
// A fixture whose contents disagree with its name fails this gate, which is
// what the fail tree in gate-selftest's fixtures exercises.
import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { repoRoot, fail } from './lib.mjs';

// The guard itself is always the real one; only the fixtures are retargetable.
const guard = join(dirname(fileURLToPath(import.meta.url)), '..', 'plan-guard', 'check-plan.mjs');
const fixtureDir = join(repoRoot, 'tools/plan-guard/fixtures');

const problems = [];
let checked = 0;

if (!existsSync(fixtureDir)) {
	problems.push('tools/plan-guard/fixtures/ is missing; the destroy guard would be untested');
} else {
	const files = readdirSync(fixtureDir).filter((f) => f.endsWith('.json'));
	if (files.length === 0) problems.push('tools/plan-guard/fixtures/ holds no fixtures');

	for (const file of files) {
		const expectFailure = file.endsWith('.destroy.json');
		if (!expectFailure && !file.endsWith('.clean.json')) {
			problems.push(`${file}: name must end in .clean.json or .destroy.json`);
			continue;
		}
		const res = spawnSync(process.execPath, [guard, join(fixtureDir, file)], { encoding: 'utf8' });
		const refused = res.status !== 0;
		if (refused !== expectFailure) {
			problems.push(
				expectFailure
					? `${file}: the guard ACCEPTED a plan that destroys resources`
					: `${file}: the guard refused a clean plan\n    ${(res.stderr || res.stdout).trim()}`
			);
		}
		checked++;
	}
}

if (fail('gate-plan-guard', problems)) process.exit(1);
console.log(`gate-plan-guard OK: destroy guard behaves on ${checked} plan fixture(s)`);
