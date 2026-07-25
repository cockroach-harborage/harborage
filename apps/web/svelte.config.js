import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter(),
		// Strict CSP (ARCHITECTURE §17.5): nonces on dynamic responses, hashes on
		// prerendered pages ("auto"). No inline/eval anywhere. gate-csp.mjs enforces.
		//
		// The COMPLETE policy lives here, not in _headers, because SvelteKit appends
		// its own hashes for the inline hydration bootstrap to `script-src`. A second,
		// independently-enforced policy in _headers that constrained `script-src`
		// (directly, or via a `default-src` fallback) would lack those hashes and
		// block hydration on every prerendered page. _headers therefore carries only
		// directives that never involve an inline hash, plus `frame-ancestors`, which
		// browsers ignore in a meta tag.
		//
		// `connect-src` must allow the R2 S3 endpoint: the vault upload PUTs parts
		// directly to a presigned URL (lib/uploads.ts), so 'self' alone would break
		// the evidence path. Bytes never proxy a Worker, by design.
		csp: {
			mode: 'auto',
			directives: {
				'default-src': ['none'],
				// Turnstile's api.js can only be loaded from challenges.cloudflare.com
				// (the docs are explicit that the exact URL is required). Adding a
				// third-party origin to script-src on a browser-crypto PWA is a real
				// weakening and is stated as one: that origin can execute in our page.
				// It is accepted because the alternative is no personhood check at all
				// in front of intake, and it is scoped to ONE exact host with no
				// wildcard. The widget renders in an iframe from the same host, hence
				// frame-src.
				'script-src': ['self', 'https://challenges.cloudflare.com'],
				'style-src': ['self'],
				'img-src': ['self', 'blob:', 'data:'],
				'font-src': ['self'],
				'connect-src': [
					'self',
					'https://*.r2.cloudflarestorage.com',
					'https://challenges.cloudflare.com'
				],
				'worker-src': ['self'],
				'manifest-src': ['self'],
				'media-src': ['self', 'blob:'],
				'object-src': ['none'],
				'base-uri': ['none'],
				'form-action': ['none'],
				'frame-src': ['https://challenges.cloudflare.com'],
				'frame-ancestors': ['none'],
				'require-trusted-types-for': ['script'],
				// Allowlisting policy NAMES is stronger than requiring Trusted Types
				// alone: without this, injected script may mint its own permissive
				// policy. 'svelte-trusted-html' is Svelte 5's internal policy and
				// 'sveltekit-trusted-url' is Kit's service-worker registration policy
				// (Kit refuses to build without either); 'default' is the narrow
				// createScriptURL-only policy in lib/pipeline/pipeline-client.ts that
				// lets the capture Web Worker be constructed.
				'trusted-types': [
					'svelte-trusted-html',
					'sveltekit-trusted-url',
					'default',
					// One-output policy for the Turnstile script URL. `.src` is a
					// TrustedScriptURL sink and the `default` policy above rejects
					// cross-origin URLs by design, so Turnstile needs its own; it
					// ignores its argument and returns one hardcoded constant.
					'turnstile-script'
				]
			}
		},
		prerender: {
			// /archive/verify is deliberately unlinked from the tab bar: it is for
			// someone checking a record they were handed, not a browse destination.
			// The crawler cannot find it, so it is named here or it never renders.
			// /nearby/report is reachable from /nearby, so the crawler finds it. Named
			// anyway, with the reason: /nearby only renders the link once the zone
			// list verifies, and the pinned publisher directory is empty, so on a
			// production build the crawler walks a page where that link is absent.
			entries: [
				'/',
				'/hi',
				'/limits',
				'/hi/limits',
				'/archive/verify',
				'/hi/archive/verify',
				'/nearby/report',
				'/hi/nearby/report'
			]
		}
	}
};

export default config;
