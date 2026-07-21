// Runs every gate-*.mjs in this directory. Any non-zero exit fails the build.
// Gates encode binding invariants (CLAUDE.md, ARCHITECTURE §17.5) — do not skip
// or weaken a gate to make a change pass; change the change.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const gates = readdirSync(here)
	.filter((f) => f.startsWith('gate-') && f.endsWith('.mjs'))
	.sort();

let failed = 0;
for (const gate of gates) {
	const res = spawnSync(process.execPath, [join(here, gate)], { stdio: 'inherit' });
	if (res.status !== 0) failed++;
}
if (failed > 0) {
	console.error(`\n${failed} gate(s) failed.`);
	process.exit(1);
}
console.log(`\nAll ${gates.length} gates passed.`);
