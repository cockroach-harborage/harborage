/**
 * The §63 BSA certificate artifact (ARCHITECTURE §7.2, §16).
 *
 * The platform ASSEMBLES this; two humans sign it off-platform. There is
 * deliberately no code path that produces a signature, and `signatures` is typed
 * as an empty tuple so adding one is a type error rather than an oversight: a
 * §63(4) certificate is a statement by a person in charge and a qualified
 * expert, and a server that could mint one would be forging their attestation.
 *
 * THE CLAIM IS SCALED TO THE EVIDENCE, ALWAYS. §19:1266 makes `original_status`
 * a first-class exported state precisely so this artifact cannot overstate what
 * is held. A digest registered without the bytes ever reaching the vault is a
 * genuinely weaker claim, and the artifact says so in its own text rather than
 * leaving a reader to infer it from a field they may not check. It still emits:
 * refusing outright would quietly drop the honest record of what we do hold.
 *
 * PRESERVATION, NOT ADMISSIBILITY. Never softened, never omitted, never made
 * conditional on the custody strength. Whether a court accepts anything is a
 * question for that court.
 */

export const EXPORT_SCHEMA_VERSION = 'harborage/bsa-export/v1';

/**
 * How strong the custody claim actually is. Required with no default: a default
 * would silently decide the one question this artifact exists to answer.
 */
export type CustodyStrength = 'vaulted_original' | 'registered_hash_only';

export const STATEMENT_PRESERVATION =
	'This record supports preservation for lawful processes. It is not a guarantee that any court will admit this material.';

export const STATEMENT_WEAK_CLAIM =
	'We hold the digest of this file. We do not hold the file itself. This is a weaker claim than custody of the material.';

export const STATEMENT_UNSIGNED =
	'This artifact is unsigned. A section 63(4) certificate requires signatures from a person in charge and a qualified expert, made off this platform.';

export interface CustodyLine {
	seq: number;
	event: string;
	actorBand: string;
	detail: string;
	atBucket: string;
	recordHash: string;
	prevHash: string;
}

export interface BsaExportInput {
	anchor: string;
	citableId: string;
	originalStatus: string;
	derivativeSha256?: string | undefined;
	custodyLines: readonly CustodyLine[];
	checkpointRoot?: string | undefined;
	/** True only once an EXTERNAL anchor exists. `archive_anchoring` ships OFF. */
	externallyAnchored?: boolean | undefined;
	builtBucket: string;
}

export interface BsaExport {
	schema: typeof EXPORT_SCHEMA_VERSION;
	anchor: string;
	citable_id: string;
	custody_strength: CustodyStrength;
	original_status: string;
	derivative_sha256: string | null;
	custody: readonly CustodyLine[];
	checkpoint_root: string | null;
	externally_anchored: boolean;
	statements: readonly string[];
	/** Always empty. The platform assembles; humans sign off-platform. */
	signatures: readonly [];
	built_bucket: string;
}

export function custodyStrengthFor(originalStatus: string): CustodyStrength {
	return originalStatus === 'vaulted' ? 'vaulted_original' : 'registered_hash_only';
}

export function assembleBsaExport(input: BsaExportInput): BsaExport {
	const strength = custodyStrengthFor(input.originalStatus);
	const statements: string[] = [STATEMENT_PRESERVATION, STATEMENT_UNSIGNED];
	// Order matters for a reader: the limit on what we hold comes before the
	// custody lines, not as a footnote after them.
	if (strength === 'registered_hash_only') statements.splice(1, 0, STATEMENT_WEAK_CLAIM);

	return {
		schema: EXPORT_SCHEMA_VERSION,
		anchor: input.anchor,
		citable_id: input.citableId,
		custody_strength: strength,
		original_status: input.originalStatus,
		derivative_sha256: input.derivativeSha256 ?? null,
		custody: input.custodyLines,
		checkpoint_root: input.checkpointRoot ?? null,
		// Defaults to false. `archive_anchoring` is off, so there is no external
		// anchor today, and an artifact that implied otherwise would be claiming
		// third-party corroboration that does not exist.
		externally_anchored: input.externallyAnchored === true,
		statements,
		signatures: [],
		built_bucket: input.builtBucket
	};
}
