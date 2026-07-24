// safeLog gate (ARCHITECTURE §10.5, §17.5): safeLog() is the only logging path.
// Bans raw console.* in shipped code and sensitive field names at safeLog call sites.
import { join, relative } from 'node:path';
import { repoRoot, walk, read, fail } from './lib.mjs';

const CODE_ROOTS = ['apps', 'workers', 'packages'].map((d) => join(repoRoot, d));
const ALLOWED = [/safe-log\.ts$/, /\.test\.ts$/, /\.spec\.ts$/, /\.d\.ts$/];

const CONSOLE_RE = /\bconsole\s*\.\s*(log|info|warn|error|debug|trace)\b/;
// Field names that must never appear as keys in a safeLog payload.
// `ephemeral_id` is Turnstile's cross-request visitor correlator — logging it
// on any protestor path builds a device-linked pseudo-roster (ARCHITECTURE §9.1).
const SENSITIVE_KEY_RE =
	/\b(ip|geo|lat|lng|latitude|longitude|location|token|secret|authorization|cookie|email|phone|body|url|mnemonic|seed|pubkey|key|ephemeral_id)\s*:/i;

const problems = [];
let scanned = 0;
for (const root of CODE_ROOTS) {
	for (const file of walk(root)) {
		if (!/\.(ts|js|svelte)$/.test(file)) continue;
		if (ALLOWED.some((re) => re.test(file))) continue;
		scanned++;
		const text = read(file);
		const rel = relative(repoRoot, file);
		let m = text.match(CONSOLE_RE);
		if (m) {
			const line = text.slice(0, m.index).split('\n').length;
			problems.push(`${rel}:${line} — raw console.${m[1]} (use safeLog)`);
		}
		for (const call of text.matchAll(/safeLog\s*\(([^)]*)\)/gs)) {
			const km = call[1].match(SENSITIVE_KEY_RE);
			if (km) {
				const line = text.slice(0, call.index).split('\n').length;
				problems.push(
					`${rel}:${line} — sensitive field ${JSON.stringify(km[1])} in safeLog payload`
				);
			}
		}
	}
}

if (fail('gate-safelog', problems)) process.exit(1);
console.log(`gate-safelog OK: ${scanned} file(s), no raw console.*, no sensitive fields logged`);
