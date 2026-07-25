/**
 * The intake sealed-box public key, pinned on first use (§19.1).
 *
 * The metadata envelope is sealed to this key so it is opaque in transit, in
 * the queue, and to a compromised edge Worker. The platform holds the private
 * half, so this is SEALED-TO-PLATFORM and NOT end-to-end — it buys nothing
 * against legal compulsion, and the copy at /limits says so.
 *
 * Why trust-on-first-use rather than a key baked into the build: the app shell
 * is served from the same edge that serves this key (§9.5). An adversary able
 * to swap the published key is equally able to swap a pinned constant in the
 * shell, so baking it in would look stronger while protecting against nothing.
 * Pinning on first use at least makes a LATER swap visible, which is a real if
 * modest property, and it is the honest one to claim.
 */
import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'harborage-identity';
const STORE_META = 'meta';
const PIN_KEY = 'intake-key-pin';

export type IntakeKeyState =
	| { status: 'ok'; publicKey: Uint8Array }
	| { status: 'none' }
	| { status: 'changed'; publicKey: Uint8Array; pinned: string };

let dbP: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
	if (!dbP) {
		// Same database identity.ts owns; opening at version 1 without an upgrade
		// callback joins the existing stores rather than racing to recreate them.
		dbP = openDB(DB_NAME, 1, {
			upgrade(d) {
				if (!d.objectStoreNames.contains('keys')) d.createObjectStore('keys');
				if (!d.objectStoreNames.contains(STORE_META)) d.createObjectStore(STORE_META);
			}
		});
	}
	return dbP;
}

/**
 * Release this module's handle on the identity database. It is a SECOND
 * connection to the same database identity.ts owns, and `deleteDatabase` blocks
 * silently while either is open, so the erase must close both.
 */
export async function closeIntakeKeyDb(): Promise<void> {
	const pending = dbP;
	dbP = null;
	if (pending) (await pending).close();
}

function unhex(s: string): Uint8Array {
	const out = new Uint8Array(s.length / 2);
	for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(s.slice(i * 2, i * 2 + 2), 16);
	return out;
}

/**
 * Resolve the key to seal to, pinning it the first time it is seen.
 *
 * `served` is the hex string from /api/intake/status, or null when the server
 * publishes none. A malformed or absent key resolves to 'none' and the caller
 * must refuse to send: sealing to a key we cannot validate would be worse than
 * not sending.
 */
export async function resolveIntakeKey(served: string | null): Promise<IntakeKeyState> {
	if (!served || !/^[0-9a-f]{64}$/.test(served)) return { status: 'none' };

	let pinned: string | undefined;
	try {
		pinned = (await (await db()).get(STORE_META, PIN_KEY)) as string | undefined;
	} catch {
		// No storage (private mode, quota): proceed unpinned rather than blocking
		// a send. The pin is a detection aid, not the confidentiality boundary.
		return { status: 'ok', publicKey: unhex(served) };
	}

	if (pinned && pinned !== served) {
		return { status: 'changed', publicKey: unhex(served), pinned };
	}
	if (!pinned) {
		try {
			await (await db()).put(STORE_META, served, PIN_KEY);
		} catch {
			// best-effort pin
		}
	}
	return { status: 'ok', publicKey: unhex(served) };
}

/** Accept a changed key deliberately, e.g. after a documented rotation. */
export async function acceptIntakeKeyChange(served: string): Promise<void> {
	try {
		await (await db()).put(STORE_META, served, PIN_KEY);
	} catch {
		// best-effort
	}
}
