/**
 * Client-side verification of an accountability record (ARCHITECTURE §8.2).
 *
 * THIS MODULE IS THE GUARANTEE. Everything else in the naming path is
 * defence-in-depth:
 *
 *   1. `accountability_naming` is LOCKED with no FLAG_NAMES entry, so no Worker
 *      code that consults it typechecks and the publish route's first statement
 *      is an unconditional refusal.
 *   2. D1 CHECK constraints refuse a PUBLISHED row that misses any §8.2 condition.
 *   3. The api re-verifies the quorum bundle from scratch before any public write.
 *   4. THIS: the reader re-derives the canonical hash from the fields it is about
 *      to render and re-checks m-of-n against its own pinned directory.
 *
 * ONLY LAYER 4 SURVIVES A COMPELLED WORKER. Layers 1-3 are code we run; a
 * compulsion order can require us to skip an `if` or write a row directly. What a
 * compelled Worker CANNOT do is forge a reviewer signature, because the platform holds no
 * reviewer secret key and cannot derive one. Reviewer keys are generated in an
 * offline m-of-n hardware-token ceremony and never enter the repo, CI, or
 * Cloudflare. (packages/crypto DOES export a generic Ed25519 sign() — an earlier
 * draft of this comment claimed otherwise, which was wrong. sign() needs a secret
 * key, and for the naming_reviewer role the platform has none.)
 * So a reader who checks the signatures themselves cannot be shown a fabricated
 * name.
 *
 * The honest boundary: this defends against a compelled or compromised SERVER. It
 * does not defend against a compelled CLIENT BUILD — an edge ordered to serve
 * poisoned JS to one targeted user defeats every client-side check, undetectably
 * from inside the page. That is why reviewer-side naming is APK-gated (§9.7), and
 * why this file says "in bulk, absent targeted injection" rather than "cannot".
 *
 * THE FAILURE MODE IS NOT AN ERROR PAGE. When verification fails the caller
 * renders the INSTITUTIONAL record — station, unit, rank band, shift — with the
 * individual identifier withheld. That page has no gap in it: the institutional
 * view is the primary surface per PRD §4.10, and the name was always the
 * exception. A reader who is being lied to sees a normal, useful page.
 *
 * Pure and DOM-free, so apps/web's vitest config runs it, and every route is
 * prerendered, so this page can be saved and run offline against a record from
 * any source.
 */
import { canonicalJson } from '@harborage/crypto';
import { SIG_CONTEXT } from '@harborage/crypto/compartments';
import { verifyRoleQuorum, type RoleSignature } from '@harborage/crypto/quorum';
import type { KeyDirectoryEntry, RevocationEntry } from '@harborage/crypto/notice';

/**
 * Reviewer keys, pinned in the app bundle.
 *
 * EMPTY BY DESIGN, like PINNED_PACK_PUBKEYS and PINNED_ZONE_PUBLISHERS. Today no
 * bundle verifies, so no individual identifier ever renders and every record
 * displays institutionally. That is the resting state, not a gap: populating it
 * needs an offline m-of-n ceremony that no code path can substitute for.
 */
export const PINNED_REVIEWER_KEYS: readonly KeyDirectoryEntry[] = [];

/** §8.2: >=2 distinct reviewer signatures over >=3 eligible reviewer keys. */
export const NAMING_REQUIRED = 2;
export const NAMING_MIN_KEYS = 3;

/**
 * The fields the canonical hash covers.
 *
 * THE HASH COVERS THE IDENTIFIER AND THE ANCHOR TOGETHER, which is what stops the
 * substitution attack: a valid bundle for record A cannot be attached to record
 * B's name, because moving the name changes the hash the signatures were made
 * over. Reviewers sign a NAME BOUND TO AN INCIDENT, never a name.
 */
export interface NamingRecord {
	id: string;
	station_code: string;
	unit_code: string | null;
	rank_band: string | null;
	shift_bucket: string | null;
	region_bucket: string;
	incident_ref: string;
	documentary_anchor_sha256: string;
	official_name: string | null;
	official_badge: string | null;
	right_of_reply_ref: string;
	corroboration_count: number;
	directory_epoch: number;
}

export interface SignedRecord {
	record: NamingRecord;
	/** What the server claims the signatures cover. Recomputed, never trusted. */
	record_hash: string;
	signatures: readonly RoleSignature[];
}

export type NamingFailure = 'malformed' | 'hash_mismatch' | 'no_quorum' | 'nothing_to_name';

export type NamingVerdict =
	| { named: true; name: string | null; badge: string | null; signers: string[] }
	| { named: false; reason: NamingFailure };

/**
 * The exact bytes a reviewer signs.
 *
 * canonicalJson, not JSON.stringify: every reviewer and every reader must produce
 * byte-identical input or a valid record reads as forged. Key order from
 * JSON.stringify is insertion order, which differs between the console that built
 * the object and the client that parsed it.
 */
export async function namingRecordHash(record: NamingRecord): Promise<string> {
	const bytes = new TextEncoder().encode(
		canonicalJson(record as unknown as Record<string, unknown>)
	);
	const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array | null {
	if (hex.length !== 64 || !/^[0-9a-f]+$/.test(hex)) return null;
	const out = new Uint8Array(32);
	for (let i = 0; i < 32; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	return out;
}

/**
 * May this reader be shown the individual identifier?
 *
 * Returns `named: false` on every failure path and never throws, because a thrown
 * error in a render path is a blank screen and a blank screen is worse than the
 * institutional record.
 */
export async function verifyNaming(
	signed: SignedRecord,
	opts: {
		directory?: readonly KeyDirectoryEntry[];
		revocations?: readonly RevocationEntry[];
	} = {}
): Promise<NamingVerdict> {
	if (!isSignedRecord(signed)) return { named: false, reason: 'malformed' };

	// Nothing to authorise. Checked FIRST so a record with no identifier cannot be
	// reported as a quorum failure, which would read as "we are hiding a name".
	if (signed.record.official_name === null && signed.record.official_badge === null)
		return { named: false, reason: 'nothing_to_name' };

	// RECOMPUTED FROM THE FIELDS WE ARE ABOUT TO RENDER, not from what the server
	// says was signed. Trusting record_hash would let a compelled edge serve a
	// genuine bundle beside altered fields.
	const derived = await namingRecordHash(signed.record);
	if (derived !== signed.record_hash) return { named: false, reason: 'hash_mismatch' };

	const messageHash = hexToBytes(derived);
	if (messageHash === null) return { named: false, reason: 'malformed' };

	const verdict = verifyRoleQuorum({
		contextTag: SIG_CONTEXT.namingRecord,
		messageHash,
		signatures: signed.signatures,
		directory: opts.directory ?? PINNED_REVIEWER_KEYS,
		revocations: opts.revocations ?? [],
		requiredRole: 'naming_reviewer',
		required: NAMING_REQUIRED,
		minDistinctKeys: NAMING_MIN_KEYS,
		epoch: signed.record.directory_epoch
	});
	if (!verdict.valid) return { named: false, reason: 'no_quorum' };

	return {
		named: true,
		name: signed.record.official_name,
		badge: signed.record.official_badge,
		signers: verdict.validSigners
	};
}

/**
 * The institutional view, which is what renders whenever verification fails — and
 * what renders alongside the name when it succeeds.
 *
 * Never individually resolvable: station, unit, rank BAND, shift BUCKET. §15 is
 * explicit that a badge number or a specific plate is individual naming, not
 * institutional, and routes to the human-gated path instead.
 */
export interface InstitutionalView {
	station_code: string;
	unit_code: string | null;
	rank_band: string | null;
	shift_bucket: string | null;
	region_bucket: string;
	incident_ref: string;
	corroboration_count: number;
}

export function institutionalView(record: NamingRecord): InstitutionalView {
	return {
		station_code: record.station_code,
		unit_code: record.unit_code,
		rank_band: record.rank_band,
		shift_bucket: record.shift_bucket,
		region_bucket: record.region_bucket,
		incident_ref: record.incident_ref,
		corroboration_count: record.corroboration_count
	};
}

/**
 * Shape check before any crypto runs.
 *
 * Written out field by field rather than trusted, because this object decides
 * whether a person's name appears on a public page. An unexpected shape is
 * 'malformed', which withholds the name.
 */
function isSignedRecord(v: unknown): v is SignedRecord {
	if (typeof v !== 'object' || v === null) return false;
	const o = v as Record<string, unknown>;
	if (typeof o.record_hash !== 'string') return false;
	if (!Array.isArray(o.signatures)) return false;
	for (const s of o.signatures) {
		if (typeof s !== 'object' || s === null) return false;
		const sig = s as Record<string, unknown>;
		if (typeof sig.key_id !== 'string' || typeof sig.sig !== 'string') return false;
	}
	const r = o.record;
	if (typeof r !== 'object' || r === null) return false;
	const rec = r as Record<string, unknown>;
	const strings = [
		'id',
		'station_code',
		'region_bucket',
		'incident_ref',
		'documentary_anchor_sha256',
		'right_of_reply_ref'
	];
	for (const k of strings) if (typeof rec[k] !== 'string') return false;
	const nullableStrings = [
		'unit_code',
		'rank_band',
		'shift_bucket',
		'official_name',
		'official_badge'
	];
	for (const k of nullableStrings) if (rec[k] !== null && typeof rec[k] !== 'string') return false;
	if (typeof rec.corroboration_count !== 'number') return false;
	if (typeof rec.directory_epoch !== 'number') return false;
	// EXACTLY these fields. An extra one is a field the hash does not cover on the
	// signer's side but would cover here, so a valid record would read as forged —
	// and worse, a field somebody added to render without deciding it was safe.
	return Object.keys(rec).length === strings.length + nullableStrings.length + 2;
}
