/**
 * Env interfaces mirroring wrangler.jsonc bindings 1:1 (ARCHITECTURE §18.3).
 * The manifest is the source of truth; a binding added in a wrangler config
 * without its Env field here (or the reverse) is a build error — CI diffs the
 * `wrangler types` output against committed config.
 *
 * Milestone keys: fields marked M1+ exist here as the authored contract and
 * enter a wrangler.jsonc only when that worker ships.
 */
import type {
	D1Database,
	DurableObjectNamespace,
	Fetcher,
	KVNamespace,
	Queue,
	R2Bucket
} from '@cloudflare/workers-types';

/** Fail-closed feature flags. Read via flags.ts only — never gate on raw KV. */
export interface FlagBindings {
	FLAGS: KVNamespace;
}

/** apps/web — M0 */
export interface WebEnv extends FlagBindings {
	CONFIG: KVNamespace;
	I18N: KVNamespace;
	ASSETS: Fetcher;
}

/** apps/console — M0 (FlagState); M1 adds NoticeLog + CurationCoordinator. */
export interface ConsoleEnv extends FlagBindings {
	DB: D1Database;
	FLAG_STATE: DurableObjectNamespace;
	/** Access application AUD tag (wrangler secret). Empty ⇒ every request is denied. */
	ACCESS_AUD: string;
	/** Access team domain, e.g. "example.cloudflareaccess.com" (wrangler var). */
	ACCESS_TEAM_DOMAIN: string;
}

/** workers/api — M1. DO classes join per the §18.3 milestone column. */
export interface ApiEnv extends FlagBindings {
	DB: D1Database;
	RATE_LIMIT: DurableObjectNamespace;
	EVIDENCE_VAULT: R2Bucket;
	PUBLIC_MEDIA: R2Bucket;
	MODERATION_BULK: Queue;
	LIFE_SAFETY: Queue;
	/** Turnstile secret (wrangler secret, set at intake switch-on). Empty ⇒ verify fails closed. */
	TURNSTILE_SECRET?: string;
}

/** workers/media — M1 */
export interface MediaEnv extends FlagBindings {
	/** S3-API credentials for presigning only (bucket-scoped, short-TTL URLs). */
	R2_PRESIGN_ACCESS_KEY_ID: string;
	R2_PRESIGN_SECRET_ACCESS_KEY: string;
	R2_ACCOUNT_ID: string;
}

/** workers/consumer — M2 */
export interface ConsumerEnv extends FlagBindings {
	DB: D1Database;
	VERIFICATION_STATE: DurableObjectNamespace;
}
