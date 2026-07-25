import { defineConfig } from 'vitest/config';

// `cloudflare:workers` has no Node resolution, so importing a Durable Object
// class in a plain test fails at module load. Aliasing it to a stub keeps the
// DO logic testable without moving that logic out of src/do/, which is the only
// place gate-memory-only looks for durable-write violations.
export default defineConfig({
	test: {
		include: ['test/**/*.test.ts'],
		alias: {
			'cloudflare:workers': new URL('./test/stubs/cloudflare-workers.ts', import.meta.url).pathname
		}
	}
});
