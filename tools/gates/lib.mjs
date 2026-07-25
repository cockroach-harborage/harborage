// Shared helpers for gate scripts.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Normally the repo. HARBORAGE_GATE_ROOT retargets every gate at a fixture tree
// so gate-selftest.mjs can prove each gate actually FAILS on a broken input.
// Without it no gate here had ever been shown to fail, and this repo has already
// shipped two that could not (see gate-sealed-body.mjs). The override is a
// test-harness affordance only: nothing in CI or the deploy path sets it, and
// every gate still reads the real repo when it is unset.
export const repoRoot = process.env.HARBORAGE_GATE_ROOT
	? resolve(process.env.HARBORAGE_GATE_ROOT)
	: fileURLToPath(new URL('../..', import.meta.url));

const SKIP_DIRS = new Set([
	'node_modules',
	'.git',
	'.svelte-kit',
	'dist',
	'build',
	'.wrangler',
	'.terraform',
	'paraglide',
	'test-results',
	'playwright-report'
]);

export function* walk(dir) {
	if (!existsSync(dir)) return;
	for (const entry of readdirSync(dir)) {
		if (SKIP_DIRS.has(entry)) continue;
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) yield* walk(path);
		else yield path;
	}
}

export function read(path) {
	return readFileSync(path, 'utf8');
}

export function fail(gate, problems) {
	if (problems.length === 0) return false;
	for (const p of problems) console.error(`${gate} FAIL: ${p}`);
	return true;
}
