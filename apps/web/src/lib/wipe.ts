/**
 * Erase what is on this phone (ARCHITECTURE §19:1302, §19:1308).
 *
 * Every step is best-effort and independent, so one failure cannot abort the
 * rest. A wipe that stops halfway because `caches` threw is worse than one that
 * reports partial success: the user believes the phone is clean.
 *
 * NO NETWORK CALL. §19 suggests aborting the multipart upload remotely, but a
 * wipe has to be fast, has to work offline, and must not emit a distinctive
 * burst of traffic at the moment someone is under duress -- an AbortMultipart
 * for each pending item is a legible "this person just wiped their phone"
 * signal to anyone watching the link. R2's abort-incomplete-multipart-30d
 * lifecycle rule on the evidence-vault bucket (infra/r2.tf) collects the strays.
 */
import { IdbOutboxStore } from '@harborage/outbox';
import { documents } from '$lib/documents';
import { closeIdentityDb, wipe as wipeIdentity } from '$lib/identity';
import { closeIntakeKeyDb } from '$lib/intake-key';
import { haltOutbox } from '$lib/outbox-runner';
import { forgetBriefing } from '$lib/briefing.svelte';
import { databasesToDelete, type WipeScope } from '$lib/wipe-core';

export interface WipeReport {
	documents: boolean;
	outbox: boolean;
	caches: number;
	serviceWorkers: number;
	databases: string[];
	identity: boolean;
}

/** A blocked delete must not hang the screen behind a stuck handle. */
const DELETE_TIMEOUT_MS = 3_000;

function deleteDatabase(name: string): Promise<boolean> {
	return new Promise((resolve) => {
		let settled = false;
		const finish = (ok: boolean) => {
			if (settled) return;
			settled = true;
			resolve(ok);
		};
		const timer = setTimeout(() => finish(false), DELETE_TIMEOUT_MS);
		try {
			const req = indexedDB.deleteDatabase(name);
			req.onsuccess = () => {
				clearTimeout(timer);
				finish(true);
			};
			req.onerror = () => {
				clearTimeout(timer);
				finish(false);
			};
			// Another tab holds a connection. The stores are already cleared by
			// the time we get here, so the data is gone either way.
			req.onblocked = () => {
				clearTimeout(timer);
				finish(false);
			};
		} catch {
			clearTimeout(timer);
			finish(false);
		}
	});
}

export async function wipeDevice(scope: WipeScope): Promise<WipeReport> {
	// A briefing acknowledgement is memory-only and would die with the tab anyway,
	// but an erase must not leave a screen one tap from a compose form.
	forgetBriefing();
	// Stop the runner first, and wait for it to release its connection. A
	// visibilitychange between clearing a store and deleting its database would
	// otherwise reopen what we just cleared, and a connection left open makes
	// the delete below block silently.
	await haltOutbox();

	const report: WipeReport = {
		documents: false,
		outbox: false,
		caches: 0,
		serviceWorkers: 0,
		databases: [],
		identity: false
	};

	// 1. Clear the object stores. This is what actually destroys the data, and
	// it works even when the delete below is blocked by another tab.
	const outbox = new IdbOutboxStore();
	try {
		await documents.wipeAll();
		report.documents = true;
	} catch {
		/* best effort */
	}
	try {
		await outbox.wipeAll();
		report.outbox = true;
	} catch {
		/* best effort */
	}
	if (scope.identity) {
		try {
			await wipeIdentity();
			report.identity = true;
		} catch {
			/* best effort */
		}
	}

	// 2. Release every cached handle, or the deletes below silently block.
	await Promise.allSettled([
		documents.close(),
		outbox.close(),
		closeIntakeKeyDb(),
		...(scope.identity ? [closeIdentityDb()] : [])
	]);

	// 3. Remove the databases themselves, so nothing remains to enumerate.
	for (const name of databasesToDelete(scope)) {
		if (await deleteDatabase(name)) report.databases.push(name);
	}

	// 4. Saved pages. The service worker precaches the whole shell, and a
	// cached page can hold content the user expected to be gone.
	try {
		const keys = await caches.keys();
		await Promise.allSettled(keys.map((k) => caches.delete(k)));
		report.caches = keys.length;
	} catch {
		/* best effort */
	}

	// 5. Unregister the worker. Without this the next navigation is served from
	// a controller whose caches we just emptied, which is both a stale shell and
	// a live handle on storage the user believes is gone.
	try {
		const regs = await navigator.serviceWorker.getRegistrations();
		await Promise.allSettled(regs.map((r) => r.unregister()));
		report.serviceWorkers = regs.length;
	} catch {
		/* best effort */
	}

	// 6. Theme and text size are a small usage fingerprint on a shared phone.
	try {
		localStorage.clear();
		sessionStorage.clear();
	} catch {
		/* best effort */
	}

	return report;
}
