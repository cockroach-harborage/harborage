/**
 * workers/api (M1) worker entry. Wires the Hono app (src/app.ts) as the fetch
 * handler, the Cron materializer as the scheduled handler, and exports the
 * memory-only RateLimit Durable Object. Kept thin so app.ts stays testable in
 * plain Node (this file is the only one that imports `cloudflare:workers`).
 */
import { app, materialize } from './app.ts';
import { safeLog } from '@harborage/worker-lib/safe-log';
import type { ApiEnv } from '@harborage/worker-lib/types';

export { RateLimit } from './do/RateLimit.ts';

export default {
	fetch: (req: Request, env: ApiEnv, ctx: ExecutionContext) => app.fetch(req, env, ctx),
	async scheduled(_event: ScheduledController, env: ApiEnv, _ctx: ExecutionContext): Promise<void> {
		try {
			await materialize(env);
			safeLog('materialize', { statusClass: '2xx' });
		} catch {
			safeLog('materialize', { statusClass: '5xx' });
		}
	}
};
