/**
 * The life-safety lane (ARCHITECTURE §3.1, §18.4).
 *
 * WHY A QUEUE FOR A HANDLER THAT ONLY LOGS. The deliverable is ISOLATION, not
 * processing: a saturated moderation queue cannot delay a life-safety message,
 * the DLQ is separate so a poison message here does not poison that one, the
 * concurrency is its own, and `metrics().oldestMessageTimestamp` gives the
 * operator something to page on. Calling safeLog straight from the request path
 * would be sampled and would block the response; the queue send does neither.
 *
 * THE PAYLOAD CARRIES NO USER CONTENT AND NO REGION. "Medical broker saturated
 * in IN-PB-LDH on 2026-07-26" sitting in a dead-letter queue that retains for
 * days is a protest-intensity signal tied to a place, which is the
 * who-was-where class this platform does not hold. The operator learns that a
 * LANE is failing and reads aggregate Workers metrics for the rest.
 *
 * NO D1 WRITE ON THIS LANE, AT ALL. A table of when life-safety flows were
 * failing is a durable record of when a crackdown was happening.
 */

/** What can go wrong, in words that name a lane rather than a person. */
export const LIFE_SAFETY_KINDS = [
	'broker_saturated',
	'broker_unreachable',
	'mailbox_evicted',
	'accept_refused_unvetted',
	'origin_absent',
	'flag_closed_mid_flow'
] as const;
export type LifeSafetyKind = (typeof LIFE_SAFETY_KINDS)[number];

export const LIFE_SAFETY_LANES = ['medical', 'aid'] as const;
export type LifeSafetyLane = (typeof LIFE_SAFETY_LANES)[number];

/** A band, never a raw count. Same argument as capacity_bands. */
export const LIFE_SAFETY_BANDS = ['NONE', 'SOME', 'MANY'] as const;
export type LifeSafetyBand = (typeof LIFE_SAFETY_BANDS)[number];

export interface LifeSafetyEvent {
	kind: LifeSafetyKind;
	lane: LifeSafetyLane;
	band: LifeSafetyBand;
	/** Coarse day bucket. Never a precise instant. */
	bucket: string;
}

/**
 * EXACT shape, not a superset.
 *
 * An extra key is a field somebody added without deciding whether it is safe to
 * retain for days in a dead-letter queue. Silently ignoring it is how a region,
 * or a note, or a handle arrives on this lane. Same rule as
 * /api/archive/dedup's body check, and for the same reason.
 */
export function isLifeSafetyEvent(value: unknown): value is LifeSafetyEvent {
	if (typeof value !== 'object' || value === null) return false;
	const keys = Object.keys(value).sort();
	if (keys.length !== 4) return false;
	if (keys.join(',') !== 'band,bucket,kind,lane') return false;
	const v = value as Record<string, unknown>;
	if (!(LIFE_SAFETY_KINDS as readonly unknown[]).includes(v.kind)) return false;
	if (!(LIFE_SAFETY_LANES as readonly unknown[]).includes(v.lane)) return false;
	if (!(LIFE_SAFETY_BANDS as readonly unknown[]).includes(v.band)) return false;
	if (typeof v.bucket !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.bucket)) return false;
	return true;
}

export type Disposition = 'ack' | 'retry';

/**
 * Decide one message.
 *
 * Anything unrecognised RETRIES rather than acking, so it reaches the DLQ where
 * an operator can see it. A silent ack on a malformed life-safety message is the
 * one outcome with no trace at all.
 */
export function dispositionFor(body: unknown): Disposition {
	return isLifeSafetyEvent(body) ? 'ack' : 'retry';
}
