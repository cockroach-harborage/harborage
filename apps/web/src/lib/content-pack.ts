/**
 * Signed content-pack verification (ARCHITECTURE §5.6). Knowledge packs (crisis
 * cards, directory seed, taxonomy) are signed by the offline m-of-n project key
 * and verified in-app against the pinned public key. Verify-only.
 *
 * The pinned key is published by the offline key ceremony (RUNBOOK) and set here
 * once known. Until then it is empty: bundled packs render as DRAFT (with the
 * banner), and no fetched pack is trusted without a verifying signature.
 */
import { parsePublicKey, verifyMinisign } from '@harborage/crypto';

export const PINNED_PACK_PUBKEY = '';

/** True only if a detached minisign signature verifies against the pinned key. */
export function verifyContentPack(packBytes: Uint8Array, signatureFile: string): boolean {
	if (!PINNED_PACK_PUBKEY) return false;
	try {
		return verifyMinisign(parsePublicKey(PINNED_PACK_PUBKEY), packBytes, signatureFile).valid;
	} catch {
		return false;
	}
}
