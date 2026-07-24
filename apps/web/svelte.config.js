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
				'script-src': ['self'],
				'style-src': ['self'],
				'img-src': ['self', 'blob:', 'data:'],
				'font-src': ['self'],
				'connect-src': ['self', 'https://*.r2.cloudflarestorage.com'],
				'worker-src': ['self'],
				'manifest-src': ['self'],
				'media-src': ['self', 'blob:'],
				'object-src': ['none'],
				'base-uri': ['none'],
				'form-action': ['none'],
				'frame-src': ['none'],
				'frame-ancestors': ['none'],
				'require-trusted-types-for': ['script'],
				// Allowlisting policy NAMES is stronger than requiring Trusted Types
				// alone: without this, injected script may mint its own permissive
				// policy. 'svelte-trusted-html' is Svelte 5's internal policy and
				// 'sveltekit-trusted-url' is Kit's service-worker registration policy
				// (Kit refuses to build without either); 'default' is the narrow
				// createScriptURL-only policy in lib/pipeline/pipeline-client.ts that
				// lets the capture Web Worker be constructed.
				'trusted-types': ['svelte-trusted-html', 'sveltekit-trusted-url', 'default']
			}
		},
		prerender: {
			entries: ['/', '/hi', '/limits', '/hi/limits']
		}
	}
};

export default config;
