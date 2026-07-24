#!/usr/bin/env node
// Verify each committed pack matches its source (CI gate: `pnpm pack:verify`).
//
// We VERIFY, never rebuild-and-diff: recompute the pack bytes from source and
// assert they equal the committed `.harborage-pack`. A content edit that did not
// rebuild the pack fails here, so a stale (or tampered) committed pack cannot
// slip through — without depending on byte-identical rebuilds across machines
// (the recompute happens in the same process as the comparison).
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './canonical.mjs';
import { packBytes } from './build-pack.mjs';
import { PACKS, packFilename } from './packs.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = join(repoRoot, 'apps/web/static/packs');

// Known-answer guard: the on-device verifier (packages/crypto/src/pack.ts) asserts
// the same vector, so a divergence in either canonicalJson breaks CI on both sides.
if (canonicalJson({ b: 1, a: [2, 1] }) !== '{"a":[2,1],"b":1}') {
	console.error('pack:verify FAILED: canonicalJson known-answer mismatch');
	process.exit(1);
}

const problems = [];
for (const pack of PACKS) {
	const file = join(outDir, packFilename(pack));
	if (!existsSync(file)) {
		problems.push(`${packFilename(pack)} is missing — run \`pnpm pack:build\``);
		continue;
	}
	const committed = readFileSync(file, 'utf8');
	const expected = packBytes(pack);
	if (committed !== expected)
		problems.push(`${packFilename(pack)} is stale — run \`pnpm pack:build\` and commit`);
}

if (problems.length) {
	console.error('pack:verify FAILED');
	for (const p of problems) console.error(`  - ${p}`);
	process.exit(1);
}
console.log(`pack:verify OK: ${PACKS.length} pack(s) match source`);
