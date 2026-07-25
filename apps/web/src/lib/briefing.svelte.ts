/**
 * Just-in-time safety briefing acknowledgement (PRD §4.7–4.9).
 *
 * FOUR PROPERTIES, EACH DELIBERATE.
 *
 * 1. MODULE SCOPE, AND NOTHING ELSE. No localStorage, no IndexedDB, no cookie,
 *    no server record. It dies with the tab, so a reload re-arms the briefing.
 *    Persisting it would make the briefing shown-once, which is the opposite of
 *    just-in-time: the point is that somebody about to ask a stranger for help,
 *    or about to go and meet one, reads the risks AT THAT MOMENT.
 *
 * 2. ONE SLOT, NOT A SET. Acknowledging the medical briefing must not unlock the
 *    aid one. A Set lets a session accumulate acknowledgements until every
 *    compose screen is open; a single slot structurally cannot.
 *
 * 3. A TTL. An acknowledgement made forty minutes ago, on a phone that has been
 *    in a pocket since, is not informed consent to anything.
 *
 * 4. CLEARED BY QUICK EXIT AND BY ERASE. Whatever else those do, they must not
 *    leave a screen one tap from a compose form.
 *
 * HONEST BOUNDARY, and it belongs in the product copy as well as here: the
 * Worker cannot verify that a briefing was shown without recording that it was,
 * and that record is exactly the kind we refuse to hold. So this gate is
 * CLIENT-SIDE ONLY and the platform keeps no proof. What it buys is that the
 * app cannot present a compose form without the briefing first, which is a real
 * property of the app and not a claim about the person using it.
 */

/** The compose surfaces that require a briefing. Closed set. */
export const BRIEFING_TOPICS = ['medical', 'aid_need', 'aid_offer', 'accept'] as const;
export type BriefingTopic = (typeof BRIEFING_TOPICS)[number];

/** How long an acknowledgement stays good. Minutes, not hours. */
export const BRIEFING_TTL_MS = 5 * 60_000;

/**
 * The single slot. `$state` so a Svelte component re-renders when it changes;
 * module-level so there is exactly one, and so it is unreachable from any store
 * that could be persisted.
 */
const acked = $state<{ topic: BriefingTopic | null; atMs: number }>({ topic: null, atMs: 0 });

export function acknowledge(topic: BriefingTopic, nowMs: number = Date.now()): void {
	acked.topic = topic;
	acked.atMs = nowMs;
}

export function isAcknowledged(topic: BriefingTopic, nowMs: number = Date.now()): boolean {
	if (acked.topic !== topic) return false;
	return nowMs - acked.atMs < BRIEFING_TTL_MS;
}

/** Called by quick exit and by device erase. */
export function forgetBriefing(): void {
	acked.topic = null;
	acked.atMs = 0;
}
