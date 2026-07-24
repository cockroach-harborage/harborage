/**
 * workers/media (M1) worker entry. Thin wrapper over the Hono app (src/app.ts).
 */
import { app } from './app.ts';
import type { MediaEnv } from '@harborage/worker-lib/types';

export default {
	fetch: (req: Request, env: MediaEnv, ctx: ExecutionContext) => app.fetch(req, env, ctx)
};
