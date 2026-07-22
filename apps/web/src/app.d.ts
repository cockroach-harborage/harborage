import type { WebEnv } from '@harborage/worker-lib/types';

declare global {
	namespace App {
		interface Platform {
			env: WebEnv;
			ctx: ExecutionContext;
		}
	}
}

export {};
