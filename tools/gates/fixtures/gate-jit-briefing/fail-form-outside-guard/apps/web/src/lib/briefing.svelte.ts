// PASS fixture. Module scope, one slot, a TTL, and no store in sight.
export const BRIEFING_TOPICS = ['medical', 'aid_need', 'aid_offer', 'accept'] as const;
export const BRIEFING_TTL_MS = 5 * 60_000;

const acked = $state<{ topic: string | null; atMs: number }>({ topic: null, atMs: 0 });

export function acknowledge(topic: string, nowMs = Date.now()): void {
	acked.topic = topic;
	acked.atMs = nowMs;
}

export function isAcknowledged(topic: string, nowMs = Date.now()): boolean {
	if (acked.topic !== topic) return false;
	return nowMs - acked.atMs < BRIEFING_TTL_MS;
}

export function forgetBriefing(): void {
	acked.topic = null;
	acked.atMs = 0;
}
