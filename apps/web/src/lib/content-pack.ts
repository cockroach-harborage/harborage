/**
 * Signed content-pack verification for the app (ARCHITECTURE §5.6). The pack
 * logic lives in the frozen crypto module (packages/crypto/src/pack.ts, under
 * CODEOWNERS); this file only binds it to the app's pinned key list. Verify-only
 * — signing happens offline (RUNBOOK), never in this codebase.
 *
 * Trust is cryptographic: a valid minisign signature over the exact pack bytes,
 * plus a self-consistent {path:sha256} manifest. It is NEVER a self-asserted
 * field inside the content. Until the offline key ceremony pins a project key,
 * PINNED_PACK_PUBKEYS is empty, every verify fails closed, and bundled packs
 * render with the DRAFT banner.
 */
import { verifyPack } from '@harborage/crypto';
export { parsePack, verifyPackManifest, canonicalJson, type Pack } from '@harborage/crypto';

/**
 * Pinned project public keys (minisign format), epoch-aware: a rotation adds the
 * new key here without dropping the old until every signed pack is re-signed.
 * EMPTY until the offline key ceremony (RUNBOOK) — verification fails closed.
 */
export const PINNED_PACK_PUBKEYS: readonly string[] = [];

/** True only if the pack is signed by a pinned key AND its manifest is consistent. */
export function verifyContentPack(packBytes: Uint8Array, signatureFile: string): boolean {
	return verifyPack(packBytes, signatureFile, PINNED_PACK_PUBKEYS);
}
