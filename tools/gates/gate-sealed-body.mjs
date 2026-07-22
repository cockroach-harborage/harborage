// Sensitive-write-must-be-sealed harness (ARCHITECTURE §17.5).
// Every sensitive endpoint registered here must have a test asserting the
// intake worker rejects a non-sealed body. The registry existing (even empty)
// is itself enforced so the gate cannot be silently orphaned.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot, walk, read, fail } from './lib.mjs';

const registryPath = join(repoRoot, 'tools/gates/sensitive-endpoints.json');
const problems = [];

if (!existsSync(registryPath)) {
	problems.push('tools/gates/sensitive-endpoints.json is missing');
} else {
	const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
	const endpoints = registry.endpoints ?? [];
	if (endpoints.length > 0) {
		let testText = '';
		for (const file of walk(join(repoRoot, 'workers'))) {
			if (/sealed-body\.(test|spec)\.ts$/.test(file)) testText += read(file);
		}
		for (const ep of endpoints) {
			if (!testText.includes(ep)) {
				problems.push(`sensitive endpoint ${ep} has no sealed-body rejection test`);
			}
		}
	}
	if (fail('gate-sealed-body', problems)) process.exit(1);
	console.log(
		`gate-sealed-body OK: ${endpoints.length} sensitive endpoint(s) registered and tested`
	);
	process.exit(0);
}

if (fail('gate-sealed-body', problems)) process.exit(1);
