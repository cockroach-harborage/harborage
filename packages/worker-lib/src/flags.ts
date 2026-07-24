/**
 * Fail-closed feature flags (ARCHITECTURE §17.4, §10.3).
 * FlagState DO (console worker) is the source of truth and writes through to
 * the FLAGS KV namespace; every other worker reads the KV cache only.
 * Absent, malformed, or unreachable ⇒ the feature is OFF. Propagation bound is
 * the cache TTL, per colo — state this honestly, never as "instant".
 */

export const FLAG_CACHE_TTL_S = 60; // KV minimum cacheTtl; the KV write itself is the fast path

export interface FlagRecord {
	enabled: boolean;
	/** Monotonic epoch bumped on every flip; lets clients detect stale caches. */
	epoch: number;
	updatedAt: string;
}

/** Known flags. Every data-holding feature has one and ships OFF. */
export type FlagName =
	| 'heightened_threat'
	| 'notices_publish'
	| 'directory_intake'
	| 'record_intake'
	| 'incidents_publish'
	| 'ai_moderation'
	| 'archive_anchoring';

export async function flagEnabled(kv: KVNamespace, name: FlagName): Promise<boolean> {
	try {
		const raw = await kv.get(`flag:${name}`, { cacheTtl: FLAG_CACHE_TTL_S });
		if (raw === null) return false;
		const record = JSON.parse(raw) as Partial<FlagRecord>;
		return record.enabled === true;
	} catch {
		return false; // fail closed, always
	}
}

/**
 * Heightened-threat mode tightens only, never loosens: a feature is available
 * only if its own flag is on AND heightened-threat does not restrict it.
 */
export async function featureAvailable(
	kv: KVNamespace,
	name: Exclude<FlagName, 'heightened_threat'>,
	opts: { disabledUnderHeightenedThreat: boolean }
): Promise<boolean> {
	const [enabled, heightened] = await Promise.all([
		flagEnabled(kv, name),
		flagEnabled(kv, 'heightened_threat')
	]);
	if (!enabled) return false;
	if (heightened && opts.disabledUnderHeightenedThreat) return false;
	return true;
}
