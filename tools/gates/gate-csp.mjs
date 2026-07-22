// Strict-CSP + Trusted Types gate (ARCHITECTURE §17.5). Static source checks;
// the Playwright smoke test asserts the live headers. For a browser-crypto PWA
// an XSS equals the code-injection threat — never weaken this to ship a feature.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot, fail } from './lib.mjs';

const problems = [];
const webDir = join(repoRoot, 'apps/web');

if (existsSync(webDir)) {
	const svelteConfig = join(webDir, 'svelte.config.js');
	if (!existsSync(svelteConfig)) {
		problems.push('apps/web/svelte.config.js missing');
	} else {
		const cfg = readFileSync(svelteConfig, 'utf8');
		// "auto" = nonces on dynamic responses, hashes on prerendered pages.
		if (!/csp\s*:/.test(cfg) || !/mode\s*:\s*['"](nonce|auto)['"]/.test(cfg))
			problems.push('svelte.config.js: kit.csp with mode "nonce" or "auto" is required');
		if (/unsafe-inline|unsafe-eval/.test(cfg))
			problems.push('svelte.config.js: unsafe-inline/unsafe-eval must not appear');
	}
	const hooks = join(webDir, 'src/hooks.server.ts');
	if (!existsSync(hooks)) {
		problems.push('apps/web/src/hooks.server.ts missing (security headers live there)');
	} else {
		const text = readFileSync(hooks, 'utf8');
		for (const header of [
			"require-trusted-types-for 'script'",
			'X-Content-Type-Options',
			'Referrer-Policy',
			'Permissions-Policy',
			'X-Frame-Options'
		]) {
			if (!text.includes(header)) problems.push(`hooks.server.ts: missing ${header}`);
		}
	}
}

if (fail('gate-csp', problems)) process.exit(1);
console.log('gate-csp OK: strict CSP + Trusted Types + header baseline present');
