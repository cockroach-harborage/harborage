import { defineConfig } from 'vitest/config';

// `cloudflare:workers` has no Node resolution, so importing a Durable Object class
// in a plain test fails at module load. Aliasing it to a stub keeps the DO logic
// testable without moving that logic out of src/do/, which is the only place
// gate-memory-only looks for durable-write violations.
//
// Same config and same stub as workers/api. Duplicated rather than shared because
// a vitest config in a workspace package has to resolve its own paths, and a
// shared one that resolved them relative to the wrong root would silently alias
// nothing — which reads as "the DO cannot be tested" rather than as a broken path.
export default defineConfig({
	test: {
		include: ['test/**/*.test.ts'],
		alias: {
			'cloudflare:workers': new URL('./test/stubs/cloudflare-workers.ts', import.meta.url).pathname
		}
	}
});
