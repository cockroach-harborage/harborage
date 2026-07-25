/**
 * Zone-list handling (ARCHITECTURE §6.3).
 *
 * A zone id is a MEMBER OF A PRE-ENUMERATED SIGNED LIST, never a computed cell.
 * There is deliberately no function here that turns a coordinate into a zone,
 * and none anywhere else: if no such function exists, no client can be tricked
 * into computing one and no compelled Worker can be asked to.
 */
import { canonicalJson } from '@harborage/crypto/pack';
import { SIG_CONTEXT } from '@harborage/crypto/compartments';
import { verifyRoleQuorum, type RoleSignature } from '@harborage/crypto/quorum';
import type { KeyDirectoryEntry, RevocationEntry } from '@harborage/crypto/notice';

/**
 * The shape of an id: a region code and an opaque ordinal.
 *
 * Checked rather than assumed, because the id reaches the Broker-style instance
 * addressing and a free-form string there is a free-form instance namespace.
 */
const ZONE_ID_RE = /^[A-Z]{2}(-[A-Z0-9]{2,3}){1,2}-z\d{4}$/;

export function isZoneId(value: string): boolean {
	return ZONE_ID_RE.test(value);
}

export interface ZoneEntry {
	zone_id: string;
	region_bucket: string;
	label_key: string;
}

export interface SignedZoneList {
	list_epoch: number;
	zones: ZoneEntry[];
	signatures: RoleSignature[];
}

/**
 * The bytes a zone-list signature covers.
 *
 * canonicalJson, not JSON.stringify: the publisher and every verifier must
 * produce byte-identical input or a valid list reads as forged.
 */
export async function zoneListHash(
	epoch: number,
	zones: readonly ZoneEntry[]
): Promise<Uint8Array> {
	const canonical = canonicalJson({
		list_epoch: epoch,
		// Sorted, so two publishers listing the same zones in different orders
		// produce the same hash.
		zones: [...zones]
			.map((z) => ({ zone_id: z.zone_id, region_bucket: z.region_bucket, label_key: z.label_key }))
			.sort((a, b) => (a.zone_id < b.zone_id ? -1 : a.zone_id > b.zone_id ? 1 : 0))
	});
	return new Uint8Array(
		await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical) as BufferSource)
	);
}

export interface ZoneListPolicy {
	directory: readonly KeyDirectoryEntry[];
	revocations: readonly RevocationEntry[];
	required: number;
	minDistinctKeys: number;
	/**
	 * The highest list epoch this client has already accepted.
	 *
	 * A ROLLBACK FLOOR, and it is the half that a signature check alone does not
	 * give: an old list is perfectly signed, so without this a compelled edge
	 * could serve last week's list to re-enable a zone that was withdrawn.
	 */
	minEpoch: number;
}

export interface ZoneListVerdict {
	valid: boolean;
	/** Empty unless valid. There is no partial acceptance of a zone list. */
	zones: ZoneEntry[];
	reason?: string;
}

/**
 * Verify a signed zone list.
 *
 * ALL OR NOTHING. A list that fails for any reason yields no zones at all,
 * rather than the subset that happened to parse: a half-accepted list is a list
 * whose contents an attacker chose.
 */
export async function verifyZoneList(
	list: SignedZoneList,
	policy: ZoneListPolicy
): Promise<ZoneListVerdict> {
	const reject = (reason: string): ZoneListVerdict => ({ valid: false, zones: [], reason });

	if (!Number.isInteger(list.list_epoch) || list.list_epoch < policy.minEpoch)
		return reject(
			`list epoch ${list.list_epoch} is below the last accepted epoch ${policy.minEpoch}; a rolled-back list is a withdrawn zone brought back`
		);

	for (const z of list.zones) {
		if (!isZoneId(z.zone_id)) return reject(`zone id ${JSON.stringify(z.zone_id)} is malformed`);
	}
	const ids = new Set(list.zones.map((z) => z.zone_id));
	if (ids.size !== list.zones.length) return reject('the list contains a duplicate zone id');

	const quorum = verifyRoleQuorum({
		contextTag: SIG_CONTEXT.zoneList,
		messageHash: await zoneListHash(list.list_epoch, list.zones),
		signatures: list.signatures,
		directory: policy.directory,
		revocations: policy.revocations,
		requiredRole: 'zone_publisher',
		required: policy.required,
		minDistinctKeys: policy.minDistinctKeys,
		epoch: list.list_epoch
	});
	if (!quorum.valid) return reject(quorum.reason ?? 'quorum not met');

	return { valid: true, zones: [...list.zones] };
}
