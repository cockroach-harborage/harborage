import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: 'e2e',
	timeout: 60_000,
	retries: process.env.CI ? 1 : 0,
	use: {
		baseURL: 'http://127.0.0.1:8788'
	},
	webServer: {
		command: 'pnpm exec wrangler dev --port 8788 --ip 127.0.0.1',
		url: 'http://127.0.0.1:8788',
		reuseExistingServer: !process.env.CI,
		timeout: 120_000
	}
});
