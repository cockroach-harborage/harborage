/**
 * Lazy libsodium loader (§5). ~300 KB WASM — never load on first paint; only
 * the evidence-vault streaming path (secretstream) and the brokered sealed-box
 * path (M4) may call this, behind user action.
 */
type Sodium = (typeof import('libsodium-wrappers-sumo'))['default'];

let sodiumPromise: Promise<Sodium> | null = null;

export async function loadSodium(): Promise<Sodium> {
	if (!sodiumPromise) {
		sodiumPromise = import('libsodium-wrappers-sumo').then(async (mod) => {
			await mod.default.ready;
			return mod.default;
		});
	}
	return sodiumPromise;
}
