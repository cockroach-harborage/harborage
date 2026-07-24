import { defineConfig } from 'vitest/config';

// The only vitest config in the repo, and it exists for one reason: apps/web is
// the sole package holding BOTH Playwright specs and unit tests, and both use
// the .test.ts extension. Without an explicit include, vitest collects e2e/
// and fails on Playwright's incompatible `test` export.
//
// Unit tests here cover pure modules only (no $lib alias, no paraglide runtime,
// no DOM), which is why no plugins or environment are needed. Browser behaviour
// is covered by Playwright, which is the only thing that can actually catch a
// CSP or Trusted Types regression.
export default defineConfig({
	test: {
		include: ['test/**/*.test.ts']
	}
});
