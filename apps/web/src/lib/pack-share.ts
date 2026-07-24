/**
 * Peer sharing of signed knowledge packs (ARCHITECTURE §2 row 1, §5.5). A pack
 * plus its detached signature travel together as one file so another phone with
 * no internet can receive the safety content AND the key directory / revocation
 * list, and verify the signature on-device before trusting any of it. Untrusted
 * peers are safe by construction: an unsigned or altered copy fails verification
 * (verifyContentPack), so a hostile mirror can only fail to help, never poison.
 *
 * This is file export/import only. QR (a ~3 KB payload, needs an encoder
 * dependency) and the off-Cloudflare mirror (needs a provider + CI secret) are
 * separate later slices; the M1 non-CF-mirror readiness gate stays not-met.
 */
import { parsePack, verifyContentPack, verifyPackManifest, type Pack } from '$lib/content-pack';

const SHARE_FORMAT = 'harborage-share/v1';

export interface ShareBundle {
	format: string;
	/** The pack's exact canonical text (a UTF-8 JSON string). */
	pack: string;
	/** Detached minisign signature over the pack bytes, or empty if unsigned. */
	sig: string;
}

/** Build the shareable bundle text from pack bytes + its signature. */
export function buildShareBundle(packText: string, sig: string): string {
	const bundle: ShareBundle = { format: SHARE_FORMAT, pack: packText, sig };
	return JSON.stringify(bundle);
}

export type ImportVerdict =
	| { kind: 'verified'; pack: Pack }
	| { kind: 'unverified'; pack: Pack | null }
	| { kind: 'not-a-pack' };

/**
 * Verify an imported share bundle. `verified` only when the detached signature
 * checks against a pinned key AND the manifest is self-consistent. `unverified`
 * means the bytes parse as a pack but are not signature-trusted (the M1 state,
 * and the state for any hostile copy). `not-a-pack` for anything else.
 */
export function verifyShareBundle(bundleText: string): ImportVerdict {
	let bundle: ShareBundle;
	try {
		bundle = JSON.parse(bundleText) as ShareBundle;
	} catch {
		return { kind: 'not-a-pack' };
	}
	if (bundle.format !== SHARE_FORMAT || typeof bundle.pack !== 'string')
		return { kind: 'not-a-pack' };

	const packBytes = new TextEncoder().encode(bundle.pack);
	const pack = parsePack(packBytes);
	if (!pack) return { kind: 'not-a-pack' };

	const sig = typeof bundle.sig === 'string' ? bundle.sig : '';
	if (verifyContentPack(packBytes, sig) && verifyPackManifest(pack))
		return { kind: 'verified', pack };
	return { kind: 'unverified', pack };
}

/**
 * Fetch the built pack and its signature (absent at M1) and produce a share
 * bundle for download. Returns null if the pack cannot be read.
 */
export async function exportPack(
	packPath: string,
	fetchFn: typeof fetch = fetch
): Promise<string | null> {
	try {
		const [packRes, sigRes] = await Promise.all([
			fetchFn(packPath),
			fetchFn(`${packPath}.minisig`)
		]);
		if (!packRes.ok) return null;
		const packText = await packRes.text();
		const sig = sigRes.ok ? await sigRes.text() : '';
		return buildShareBundle(packText, sig);
	} catch {
		return null;
	}
}
