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
	Queue
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

/** apps/console — M0 (FlagState); M1 adds NoticeLog. */
export interface ConsoleEnv extends FlagBindings {
	DB: D1Database;
	FLAG_STATE: DurableObjectNamespace;
	/** Append-only official-notice hash-chain writer (mirrors to D1). M1. */
	NOTICE_LOG: DurableObjectNamespace;
	/** Access application AUD tag (wrangler secret). Empty ⇒ every request is denied. */
	ACCESS_AUD: string;
	/** Access team domain, e.g. "example.cloudflareaccess.com" (wrangler var). */
	ACCESS_TEAM_DOMAIN: string;
}

/**
 * workers/api — M1. DO classes join per the §18.3 milestone column. The api does
 * not bind R2: the media Worker owns all R2 access (S3 presign), so the api Env
 * (and deploy token) need no R2 scope.
 */
export interface ApiEnv extends FlagBindings {
	DB: D1Database;
	RATE_LIMIT: DurableObjectNamespace;
	/** Per-item §15 state machine. Hosted here; the consumer binds it cross-script. */
	VERIFICATION_STATE: DurableObjectNamespace;
	/** Strongly-consistent daily Neuron counter + degrade ladder. */
	SPEND_CAP: DurableObjectNamespace;
	/** One alarm for the whole re-review queue, never one per item. */
	RE_REVIEW: DurableObjectNamespace;
	MODERATION_BULK: Queue;
	LIFE_SAFETY: Queue;
	/** Read cache of the signed Key Directory + Revocation List (notice verify). */
	KEYDIR_CACHE: KVNamespace;
	/** Turnstile secret (wrangler secret, set at intake switch-on). Empty ⇒ verify fails closed. */
	TURNSTILE_SECRET?: string;
	/**
	 * PUBLIC half of the intake sealed-box keypair, hex. Served from
	 * /api/intake/status so a client can seal the metadata envelope to it. It is
	 * a public key, so a var rather than a secret. Absent ⇒ status reports no
	 * key and the client refuses to send (fail-closed).
	 */
	INTAKE_PUBLIC_KEY?: string;
	/**
	 * PUBLIC Turnstile sitekey. Embedded in the page by construction, so a var
	 * rather than a secret, and served from /api/intake/status alongside the
	 * intake public key. Absent ⇒ the client renders no widget and hides the
	 * send affordance; the Worker refuses the write either way.
	 */
	TURNSTILE_SITEKEY?: string;
}

/** workers/media — M1 */
export interface MediaEnv extends FlagBindings {
	/**
	 * S3-API credentials for presigning only (bucket-scoped, short-TTL URLs).
	 * Unset until intake switch-on (RUNBOOK), so typed optional — `ready()` refuses
	 * every request while any of the three is absent.
	 */
	R2_PRESIGN_ACCESS_KEY_ID?: string;
	R2_PRESIGN_SECRET_ACCESS_KEY?: string;
	R2_ACCOUNT_ID?: string;
	/**
	 * The api Worker's memory-only RateLimit DO, bound cross-script (script_name:
	 * "harborage-api"). One shared token-bucket namespace so an unauthenticated
	 * presign flood is bounded even before cap-cert + PoP land (M2).
	 */
	RATE_LIMIT: DurableObjectNamespace;
}

/** workers/consumer — M2 */
export interface ConsumerEnv extends FlagBindings {
	DB: D1Database;
	/** Hosted by workers/api; bound cross-script, so api deploys first. */
	VERIFICATION_STATE: DurableObjectNamespace;
	/**
	 * Tier-0 rulesets. KV-resident and never committed: a published incitement
	 * lexicon is a bypass cheat-sheet, and a repository copy would also trip
	 * gate-ai-tells on its own vocabulary.
	 */
	RULESETS: KVNamespace;
	/**
	 * PRIVATE half of the intake sealed-box keypair. A wrangler secret on the
	 * consumer ONLY — never on api, web or console.
	 *
	 * Its existence is the honest admission that the incident metadata envelope
	 * is SEALED-TO-PLATFORM and not end-to-end: that body is destined for the
	 * public incident record, so the consumer must read it. gate-sealed-body
	 * requires this binding to be declared and justified in
	 * tools/gates/sensitive-endpoints.json, and forbids any such binding
	 * existing alongside a SEALED-E2E endpoint.
	 */
	INTAKE_PRIVATE_KEY?: string;
}
