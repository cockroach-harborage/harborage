import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter(),
		// Strict CSP (ARCHITECTURE §17.5): nonces on dynamic responses, hashes on
		// prerendered pages ("auto"). No inline/eval anywhere. gate-csp.mjs enforces.
		csp: {
			mode: 'auto',
			directives: {
				'script-src': ['self'],
				'object-src': ['none'],
				'base-uri': ['self'],
				'frame-ancestors': ['none']
			}
		},
		prerender: {
			entries: ['/', '/hi', '/limits', '/hi/limits']
		}
	}
};

export default config;
