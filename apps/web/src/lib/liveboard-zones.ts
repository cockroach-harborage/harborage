/**
 * The zone list, verified ON THE DEVICE before any board is addressed.
 *
 * WHY THE CLIENT IS THE VERIFIER, AND THE WORKER IS NOT. The api serves this list
 * verbatim and does not check it. A compelled Worker can be compelled to skip an
 * `if`, so a server-side check is worth defence-in-depth and nothing more. What a
 * compelled Worker cannot do is forge a publisher signature: no Ed25519 *signing*
 * function exists anywhere in packages/crypto, only verification. So the quorum
 * check has to happen where the adversary cannot reach it, which is here.
 *
 * WHY IT MATTERS THAT THE LIST IS AUTHENTIC. A zone id is a Durable Object
 * instance name and a display label. An attacker who could inject a zone could
 * invite a district to report into a board they read, or split one crowd across
 * two boards so neither reaches the density floor and both stay suppressed. The
 * second is the quieter attack and the one signatures exist to stop.
 *
 * THE PINNED DIRECTORY SHIPS EMPTY, so no list verifies and no board is
 * addressable today. That is the resting state, not a gap: switch-on needs the
 * offline publisher-key ceremony, which no code path can substitute for.
 */
import {
	verifyZoneList,
	type SignedZoneList,
	type ZoneEntry
} from '@harborage/worker-lib/liveboard';
import type { KeyDirectoryEntry } from '@harborage/crypto/notice';

/**
 * Zone-list publisher keys, pinned in the app bundle.
 *
 * EMPTY BY DESIGN, exactly as PINNED_PACK_PUBKEYS and PINNED_VETTING_ISSUERS are.
 * Populated only by an offline ceremony that puts the keys in a signed release,
 * so a compromised edge cannot add a publisher by serving a different response.
 */
export const PINNED_ZONE_PUBLISHERS: readonly KeyDirectoryEntry[] = [];

/**
 * The quorum a zone list must clear: 2 signatures over at least 3 distinct
 * publisher keys. `minDistinctKeys` is the half a signature count alone does not
 * give — a directory holding exactly 2 keys satisfies m while giving one
 * compromised publisher half the quorum.
 */
export const ZONE_LIST_REQUIRED = 2;
export const ZONE_LIST_MIN_KEYS = 3;

export interface ZoneListState {
	zones: readonly ZoneEntry[];
	/** The highest epoch this device has ever accepted. Never decreases. */
	epoch: number;
	/**
	 * Plain reason, for the surface to render. Never a stack or a hash.
	 *
	 * FOUR REASONS, NOT TWO, and the splits are deliberate. 'unreachable' means the
	 * network or the server misbehaved; 'unverified' means someone may be lying to
	 * this device; 'rolled-back' means this device holds a newer list than it was
	 * just served. Those want different words in front of a user, and collapsing
	 * them hides the two worth telling somebody about behind the one that is
	 * usually boring.
	 */
	reason: 'ok' | 'none-listed' | 'unverified' | 'unreachable' | 'rolled-back';
}

export const EMPTY_ZONE_STATE: ZoneListState = { zones: [], epoch: 0, reason: 'none-listed' };

/**
 * Verify a fetched list against the pinned publishers and the device's own epoch
 * floor.
 *
 * THE EPOCH FLOOR IS THE ROLLBACK DEFENCE and it is the half a signature check
 * does not cover: last week's list is PERFECTLY SIGNED, so without a floor a
 * compelled edge could re-enable a zone that was withdrawn by replaying it. The
 * floor is the highest epoch this device has accepted, held by the caller.
 */
export async function verifyFetchedZones(
	list: unknown,
	floorEpoch: number
): Promise<ZoneListState> {
	if (!isSignedZoneList(list)) return { zones: [], epoch: floorEpoch, reason: 'unreachable' };

	// An empty list is a legitimate answer, not a failed one, and it needs no
	// quorum: there is nothing to attest to. Returning 'unverified' here would tell
	// a user their app is broken when in fact no zones are published yet.
	if (list.zones.length === 0) return { zones: [], epoch: floorEpoch, reason: 'none-listed' };

	// THE ROLLBACK CHECK RUNS BEFORE THE QUORUM, AND REPORTS ITS OWN REASON. Both
	// halves of that were forced by sabotage. Handing verifyZoneList a floor of 0
	// left every test green, because with no publisher pinned the quorum fails first
	// and the floor is never consulted; hoisting the check but reusing 'unverified'
	// left it green too, because then both paths return the same word and no test
	// can tell which one fired. A defence that only works once another defence
	// passes is not a defence, and this one has to hold on the day publishers ARE
	// pinned — which is the day nobody re-reads this file.
	if (list.list_epoch < floorEpoch) return { zones: [], epoch: floorEpoch, reason: 'rolled-back' };

	const verdict = await verifyZoneList(list, {
		directory: PINNED_ZONE_PUBLISHERS as KeyDirectoryEntry[],
		revocations: [],
		required: ZONE_LIST_REQUIRED,
		minDistinctKeys: ZONE_LIST_MIN_KEYS,
		// Passed as well, as defence-in-depth. Unreachable while the directory is
		// empty, which is exactly why the check above exists rather than only this.
		minEpoch: floorEpoch
	});
	// ALL OR NOTHING. verifyZoneList yields no zones on any failure, and this
	// preserves that: a half-accepted list is a list whose contents an attacker
	// chose.
	if (!verdict.valid) return { zones: [], epoch: floorEpoch, reason: 'unverified' };
	return { zones: verdict.zones, epoch: list.list_epoch, reason: 'ok' };
}

/** Zones for one region bucket, which is the only selector the client has. */
export function zonesForRegion(state: ZoneListState, regionBucket: string): readonly ZoneEntry[] {
	return state.zones.filter((z) => z.region_bucket === regionBucket);
}

/**
 * Shape check before any crypto runs.
 *
 * Separate from verification on purpose: a malformed response is 'unreachable'
 * (the network or the server misbehaved) while a well-formed one that fails the
 * quorum is 'unverified' (someone may be lying to this device). Collapsing them
 * would hide the second behind the first, which is the one worth telling a user
 * about.
 */
function isSignedZoneList(v: unknown): v is SignedZoneList {
	if (typeof v !== 'object' || v === null) return false;
	const o = v as Record<string, unknown>;
	if (typeof o.list_epoch !== 'number' || !Number.isInteger(o.list_epoch)) return false;
	if (!Array.isArray(o.zones) || !Array.isArray(o.signatures)) return false;
	return o.zones.every((z) => {
		if (typeof z !== 'object' || z === null) return false;
		const e = z as Record<string, unknown>;
		return (
			typeof e.zone_id === 'string' &&
			typeof e.region_bucket === 'string' &&
			typeof e.label_key === 'string' &&
			// A zone entry carries THREE fields. An extra one is a field nobody
			// decided was safe to render, and on this object the field somebody will
			// add is a coordinate.
			Object.keys(e).length === 3
		);
	});
}
