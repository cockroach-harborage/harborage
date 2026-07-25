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

/**
 * Known flags. Every data-holding feature has one and ships OFF.
 *
 * A runtime array rather than a bare union, so the other half of the edit can be
 * checked. Adding a flag has always required touching this file AND
 * apps/console/src/flag-policy.ts, and a union alone gives a test nothing to
 * enumerate: a flag added here and forgotten there is unflippable with no
 * failure anywhere. `FLAG_NAMES` lets apps/console assert that every known flag
 * is classified as either flippable or locked, with none left over.
 */
export const FLAG_NAMES = [
	'heightened_threat',
	'notices_publish',
	'directory_intake',
	'document_intake',
	'evidence_vault',
	'incidents_publish',
	'ai_moderation',
	'community_corroborate',
	'archive_anchoring',
	// The permanent public archive: admission, dedup, the server-side master and
	// the §63 export surface. Separate from evidence_vault because vaulting a
	// sealed original and PUBLISHING a redacted derivative forever are different
	// decisions with different irreversibility.
	'archive_publish',
	// Fingerprint-and-reference of off-platform media. There is no fetch path and
	// no URL is stored; switch-on is the counsel-gated source ToS question.
	'source_import',
	// The brokered mutual-aid channel. Off means every /api/aid/* route refuses
	// and no Broker or Mailbox instance is ever created. Switch-on additionally
	// waits on BROKER_INBOX_MAC_KEY existing and on briefing and broker humans,
	// neither of which a flag can supply.
	'aid_broker',
	// The brokered medical channel. Off means every /api/medical/* route refuses.
	// Unlike every other write flag it is NOT closed by heightened threat: the
	// routes already refuse over clearnet, which is strictly stronger and
	// unconditional today, and closing them again would leave nothing behind.
	'medical_broker',
	// Helper offers and the published capacity band. Off means no offer is
	// accepted and the read returns "not published" rather than NONE: absence is
	// not a claim, and NONE is.
	'helper_registry',
	// The zone-level live board. Writes fail CLOSED; READS use
	// disabledUnderHeightenedThreat: false, because heightened threat TIGHTENS
	// thresholds and must never blind people to TEAR_GAS (§6.5).
	'live_board',
	// Crowd bands only. Disabled ENTIRELY under heightened threat per §6.4, which
	// is why it is a separate flag rather than part of live_board.
	'crowd_bands',
	// The PUBLIC accountability surface: institutional patterns by station, unit,
	// rank band and shift. Reversible, so it lives here. Naming an individual is a
	// DIFFERENT and irreversible decision, gated by accountability_naming, which is
	// deliberately absent from this list — with no entry, flagEnabled(kv,
	// 'accountability_naming') does not typecheck, so the publish route's first
	// statement can only be an unconditional refusal. gate-naming-gate enforces the
	// absence, because "off" is a value someone flips.
	'accountability_records'
] as const;

export type FlagName = (typeof FLAG_NAMES)[number];

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
