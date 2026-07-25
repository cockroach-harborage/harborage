import { safeLog } from './safe-log.ts';

export function record(route: string): void {
	safeLog('thing', { route, outcome: 'ok' });
}
