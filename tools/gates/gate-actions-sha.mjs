// Supply-chain gate: every GitHub Action pinned to a full 40-char commit SHA
// (CLAUDE.md; ARCHITECTURE §10.6). zizmor runs in CI as well; this local gate
// keeps the rule enforceable offline.
import { join, relative } from 'node:path';
import { repoRoot, walk, read, fail } from './lib.mjs';

const problems = [];
for (const file of walk(join(repoRoot, '.github'))) {
	if (!/\.(yml|yaml)$/.test(file)) continue;
	const text = read(file);
	const lines = text.split('\n');
	lines.forEach((line, i) => {
		const m = line.match(/^\s*(?:-\s+)?uses:\s*(\S+)/);
		if (!m) return;
		const ref = m[1].replace(/['"]/g, '');
		if (ref.startsWith('./')) return; // local composite actions
		if (!/@[0-9a-f]{40}$/.test(ref)) {
			problems.push(`${relative(repoRoot, file)}:${i + 1} — not SHA-pinned: ${ref}`);
		}
	});
}

if (fail('gate-actions-sha', problems)) process.exit(1);
console.log('gate-actions-sha OK: all workflow actions pinned to full SHAs');
