/**
 * The publication predicate (ARCHITECTURE §6.3, §6.4).
 *
 * ONE RETURN SHAPE, AND IT HAS NO THIRD STATE. `publishable` answers show / do
 * not show, plus whether what shows is corroborated. There is deliberately no
 * `greyed`, no `low_confidence`, no `pending`, because the consumer's DTO has no
 * field to put one in: §6.3 says an unquorumed SAFE_EXIT is WITHHELD, not shown
 * with a caveat, and the cheapest way to keep that true is to make the caveat
 * unrepresentable.
 */
import {
	CORROBORATION_K,
	DENSITY_FLOOR_D,
	PUBLICATION_DELAY_BASE_MS,
	PUBLICATION_JITTER_MAX_MS
} from './params.ts';
import { requiresQuorum, type SignalType } from './types.ts';

export interface PublishInput {
	nowMs: number;
	/** When the SERVER first saw this signal. Never a client-supplied time. */
	firstSeenMs: number;
	/** Derived per (zone, signal, epoch). See deriveJitterMs. */
	jitterMs: number;
	/** Lower bound on distinct reporters in the zone. Never the point estimate. */
	densityLcb: number;
	/** Lower bound on distinct reporters of THIS signal. */
	signalLcb: number;
	signal: SignalType;
	/** A marshal quorum verified against the pinned directory. */
	marshalValid: boolean;
	/** Heightened threat tightens; it never loosens. */
	heightened: boolean;
}

export interface PublishVerdict {
	show: boolean;
	corroborated: boolean;
}

/** Heightened threat multiplies the delay and raises both thresholds. */
const HEIGHTENED_DELAY_MULTIPLIER = 2;
const HEIGHTENED_FLOOR_BONUS = 3;
const HEIGHTENED_K_BONUS = 2;

export function publishable(i: PublishInput): PublishVerdict {
	const withheld: PublishVerdict = { show: false, corroborated: false };

	const floor = DENSITY_FLOOR_D + (i.heightened ? HEIGHTENED_FLOOR_BONUS : 0);
	const k = CORROBORATION_K + (i.heightened ? HEIGHTENED_K_BONUS : 0);
	const delay =
		(PUBLICATION_DELAY_BASE_MS + i.jitterMs) * (i.heightened ? HEIGHTENED_DELAY_MULTIPLIER : 1);

	// 1. The delay, against the SERVER's first-seen. A client-asserted time would
	//    hand the client control of the publication delay, and shortening that
	//    delay is precisely the attack the delay defends against.
	if (i.nowMs - i.firstSeenMs < delay) return withheld;

	// 2. Suppress-until-safe-density. A handful of people must never become a
	//    visible dot, so this consumes the LOWER bound: a sketch reading 6 when
	//    the truth is 4 publishes exactly what the floor exists to hide.
	if (i.densityLcb < floor) return withheld;

	// 3. At least one reporter of this signal, over the same lower bound.
	if (i.signalLcb < 1) return withheld;

	// 4. SAFE_EXIT and DISPERSAL are WITHHELD without a quorum, not shown with a
	//    caveat. A wrong SAFE_EXIT walks people into a kettle.
	if (requiresQuorum(i.signal) && !i.marshalValid) return withheld;

	return { show: true, corroborated: i.signalLcb >= k };
}

/**
 * Jitter for one (zone, signal, epoch), derived and therefore STABLE.
 *
 * NOT RE-ROLLED PER READ, and this is the whole point. With a fresh roll each
 * read, a client polling twice a second watches the signal blink in and out, and
 * the first appearance pins the true report time to within one poll. The jitter
 * would be pure theatre, and a test that calls the predicate once would never
 * notice.
 *
 * The salt is the memory-only per-epoch dedup salt, so the mapping changes when
 * the epoch rotates and is unavailable to anyone who does not hold it.
 */
export async function deriveJitterMs(
	salt: Uint8Array,
	zoneId: string,
	signal: SignalType,
	epoch: number
): Promise<number> {
	const key = await crypto.subtle.importKey(
		'raw',
		salt as BufferSource,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const message = new TextEncoder().encode(`jitter/${zoneId}/${signal}/${epoch}`);
	const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, message as BufferSource));
	const raw = ((mac[0] ?? 0) << 24) | ((mac[1] ?? 0) << 16) | ((mac[2] ?? 0) << 8) | (mac[3] ?? 0);
	return (raw >>> 0) % (PUBLICATION_JITTER_MAX_MS + 1);
}
