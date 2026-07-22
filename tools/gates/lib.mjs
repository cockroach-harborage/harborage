// Shared helpers for gate scripts.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

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
