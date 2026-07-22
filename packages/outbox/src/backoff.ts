/**
 * Exponential backoff with full jitter (§19):
 * delay = random(0, min(60s, 1s * 2^attempt)).
 * A part can exhaust in-session attempts, but an upload is never abandoned —
 * it persists and resumes; the honest floor is handled by the caller's copy.
 */
export const MAX_BACKOFF_MS = 60_000;

export function fullJitterDelay(attempt: number, random: () => number = Math.random): number {
	const ceiling = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt);
	return Math.floor(random() * ceiling);
}
