/**
 * Ambient state for the pending-send queue, mirroring offline.svelte.ts.
 *
 * COUNT-FREE ON PURPOSE. "Waiting to send: 3 items, 48 MB" on every screen tells
 * anyone who picks up the phone that this person is holding undelivered
 * documentation, and how much. The strip says only that something is waiting;
 * per-item detail lives on /document, where the user chose to look. Under
 * heightened threat it does not render at all.
 */
import { flushOutbox, listOutbox, type RunnerDeps } from '$lib/outbox-runner';

export const outbox = $state({ pending: false, busy: false });

async function refresh(): Promise<void> {
	try {
		const rows = await listOutbox();
		outbox.pending = rows.length > 0;
	} catch {
		// A storage failure must never break the shell. No pending signal is the
		// discreet default, and /document still reads the queue directly.
		outbox.pending = false;
	}
}

/** Poll on foreground only. No timer runs while the app is backgrounded. */
export function watchOutbox(): () => void {
	const onVisible = () => {
		if (document.visibilityState === 'visible') void refresh();
	};
	document.addEventListener('visibilitychange', onVisible);
	void refresh();
	return () => document.removeEventListener('visibilitychange', onVisible);
}

/** The manual "Try now" control. Skips the decorrelation delay by design. */
export async function tryNow(deps: RunnerDeps = {}): Promise<void> {
	outbox.busy = true;
	try {
		await flushOutbox({ ...deps, manual: true });
	} finally {
		outbox.busy = false;
		await refresh();
	}
}
