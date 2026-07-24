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
		// The COMPLETE policy must live here, not in _headers: Kit appends the
		// hashes for its inline hydration bootstrap to script-src, and a second
		// independently-enforced policy could not carry them. Without an explicit
		// default-src there is no fallback, so any directive nobody listed is
		// unrestricted — which is how connect-src went missing on a browser-crypto
		// PWA, where injected script can exfiltrate plaintext to any origin.
		for (const directive of [
			'default-src',
			'script-src',
			'style-src',
			'connect-src',
			'img-src',
			'worker-src',
			'object-src',
			'base-uri',
			'form-action',
			'frame-ancestors',
			'require-trusted-types-for',
			'trusted-types'
		]) {
			if (!cfg.includes(`'${directive}'`))
				problems.push(`svelte.config.js: kit.csp.directives is missing ${directive}`);
		}
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

	// Every route is prerendered, so hooks.server.ts does not run at request time —
	// static/_headers is what actually serves the CSP + baseline on those pages.
	// Enforce Trusted Types + the header baseline there too, or prerendered pages
	// (i.e. nearly all traffic) silently ship without them.
	const headers = join(webDir, '_headers');
	if (!existsSync(headers)) {
		problems.push('apps/web/_headers missing (static security headers live there)');
	} else {
		const text = readFileSync(headers, 'utf8');
		for (const needle of [
			"require-trusted-types-for 'script'",
			// Browsers ignore frame-ancestors in a meta tag, so it only works here.
			"frame-ancestors 'none'",
			// An XSS on a browser-crypto PWA exfiltrates over connect-src.
			"connect-src 'self'",
			"object-src 'none'",
			"base-uri 'none'",
			"form-action 'none'",
			'X-Content-Type-Options',
			'Referrer-Policy',
			'X-Frame-Options'
		]) {
			if (!text.includes(needle)) problems.push(`_headers: missing ${needle}`);
		}
		if (/unsafe-inline|unsafe-eval/.test(text))
			problems.push('_headers: unsafe-inline/unsafe-eval must not appear');
		// script-src/style-src here would be a second policy WITHOUT Kit's inline
		// hashes, and two CSP policies are enforced independently — hydration would
		// break on every prerendered page. Keep them in svelte.config.js only.
		if (/^\s*Content-Security-Policy:.*\b(script-src|default-src)\b/m.test(text))
			problems.push(
				'_headers: script-src/default-src belong in svelte.config.js (Kit adds hashes)'
			);
	}
}

// The privileged surface must be at least as strict as the public one. It is
// server-rendered with no client JS, so it needs no inline-hash carve-out.
const consoleEntry = join(repoRoot, 'apps/console/src/index.ts');
if (existsSync(consoleEntry)) {
	const text = readFileSync(consoleEntry, 'utf8');
	const csp = /Content-Security-Policy['"]\s*,\s*\n?\s*(['"`])([\s\S]*?)\1/.exec(text);
	if (!csp) {
		problems.push('apps/console: no Content-Security-Policy found');
	} else {
		const policy = csp[2];
		for (const needle of ["default-src 'none'", "base-uri 'none'", "frame-ancestors 'none'"]) {
			if (!policy.includes(needle)) problems.push(`apps/console CSP: missing ${needle}`);
		}
		if (/unsafe-eval/.test(policy)) problems.push('apps/console CSP: unsafe-eval must not appear');
		// script-src is absent by design (default-src 'none' covers it, and the
		// console ships no client JS). If script ever lands, it must be explicit.
		if (/script-src/.test(policy) && /unsafe-inline/.test(policy))
			problems.push("apps/console CSP: script-src must not allow 'unsafe-inline'");
	}
}

if (fail('gate-csp', problems)) process.exit(1);
console.log('gate-csp OK: strict CSP + Trusted Types + header baseline present');
