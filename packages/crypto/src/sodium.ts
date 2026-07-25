/**
 * Lazy libsodium loader (§5). ~300 KB WASM — never load on first paint; ONLY
 * the evidence-vault streaming path (secretstream) may call this, behind user
 * action.
 *
 * Corrected at M4 (2026-07-26): this used to also name the brokered channel as
 * a caller. It is not one. The brokered lane uses `sealed-box.ts` — the same
 * construction with HKDF in place of the blake2b derivation, `@noble` only —
 * because a 2G phone should not fetch 300 KB of WASM at the moment someone is
 * injured. That leaves libsodium confined behind the evidence vault, which is
 * what §5 always said and is now literally true.
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
