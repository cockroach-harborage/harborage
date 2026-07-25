# Session prompt — finish M4 (Brokered aid), then M5 (Realtime + accountability)

Continue building Harborage (repo: `/Users/ameenahsan/projects/cockroach-app`) —
Cloudflare-native civic infrastructure for peaceful, lawful protest and
human-rights documentation in India. Read `CLAUDE.md`, `PRD.md`,
`ARCHITECTURE.md` first (source of truth; **ARCH §18 overrides earlier
sections**, §14/§18.3 authoritative on version pins). Read the auto-loaded
memory (`harborage-project.md`, `harborage-m2-complete.md`,
`harborage-m3-evidence.md`) for build gotchas.

## GOAL THIS SESSION

**Finish M4 (Brokered aid), then build M5 (Realtime + accountability)** — as
much as possible, all behind fail-closed flags. Do the heavy lifting. I am a
solo maintainer and will not review every line: take ownership, make the routine
calls yourself, and stop only for a red line, legal exposure, product naming,
anything that changes what a user is promised, or a manual step you cannot
perform.

You have Cloudflare MCP, `gh`, and permission to approve production deploys.
Don't wait for me on anything you can do yourself.

## CURRENT STATE (verified 2026-07-26, end of session 10)

`main` = `7ed582a`, working tree clean, **deployed and live** at
`cockroachharborage.org`. **M0–M3 complete.** M4 is two PRs in.

- **14 CI gates**, **559 unit tests**, **67 e2e in 16 files** — all green
- Production D1: **18 migrations, verified zero rows in every table**
- **Every feature flag OFF**

Packages: `apps/{web,console}`, `workers/{api,media,consumer}`,
`packages/{crypto,worker-lib,outbox,foundry}`, `infra/` (26 tofu resources),
`tools/gates` (14), `tools/plan-guard`.

Tests: crypto 109, worker-lib 146, web 134, api 61, media 37, consumer 28,
outbox 26, console 18.

**DO classes.** console: `FlagState`, `NoticeLog` (tags to **v2**).
api: `RateLimit`, `VerificationState`, `SpendCap`, `ReReviewQueue`,
`CustodyChain` (tags to **v4** — next is **v5**).

**Flags** (`packages/worker-lib/src/flags.ts` **`FLAG_NAMES`** +
`apps/console/src/flag-policy.ts` — you must edit **both**, and a console test
now fails if you don't): `heightened_threat`, `notices_publish`,
`directory_intake`, `document_intake`, `evidence_vault`, `incidents_publish`,
`ai_moderation`, `community_corroborate`, `archive_anchoring`,
`archive_publish`, `source_import`.
LOCKED (unflippable): `accountability_naming`, `evidence_unredaction`,
`precise_location_reveal`, `permanent_delete`.

**crypto subpaths:** `. ./canary ./cap-cert ./compartments ./device-keys
./hkdf-tree ./minisign ./mnemonic ./notice ./pack ./sealed-box ./shamir
./signature ./sodium ./vault-key`
**worker-lib subpaths:** `. ./types ./safe-log ./flags ./access ./envelope
./turnstile ./cap-cert ./ratelimit ./verification ./archive ./onion
./reputation`

**Migrations end at `0018_archive_source_refs.sql`.** Next is **0019**.

**Routes today.** api: `POST /api/{incidents/register, evidence/keyring,
directory/report, archive/import, archive/dedup, archive/dispute}`,
`GET /api/{incidents/index, notices, directory/pack, archive/custody/:anchor,
archive/export/:anchor, intake/status}`. media: `/media/{master, create, part,
complete, abort, head, derivative}`.

### What M3 + the first two M4 PRs delivered

- **Outbox runner + device erase** (#56). Flushes on `online` and
  `visibilitychange → visible`; concurrency by link class; backoff honours
  `nextEarliestRetry`/`maxAge`; erase clears documents, quarantine, queue, SW
  caches and both document DBs, with account removal as an **unchecked box**.
- **Archive schema 0014–0018 + `packages/worker-lib/src/archive/`** (#57, #60,
  #62): `dhash`, `citable-id`, `probation`, `cohort`, `bsa-export`, `admission`.
  New gate **`gate-archive-custody`**.
- **`CustodyChain` DO** (#58, api tag v4) + **§63 export and `/archive/verify`**
  (#59), a client-side verifier that makes **no network request**.
- **Video poster** (#61): `videoDisposition` returns the literal `'SEALED_ONLY'`.
- **`env.IMAGES` on workers/media** (#62) — deployed clean, no error 10000.
- **`gate-memory-only` hardened** (#63) for R2, `serializeAttachment`, and
  binding-name-independent D1.
- **`packages/worker-lib/src/onion.ts`** (#64): `classifyOrigin`,
  `requireOnionOrigin`, `ONION_HEADER`, `ONION_WINDOW_MS`. `ApiEnv` gained
  `ONION_INGRESS_MAC_KEY?`. **Absent key ⇒ everything is clearnet**, so every
  onion-only route refuses for everyone today.

## M4 — what is left (7 PRs)

### 1. `gate-onion-only` + registry
`tools/gates/onion-only-endpoints.json` + `tools/gates/gate-onion-only.mjs`.
Per entry: the route exists in `workers/**`; `requireOnionOrigin` appears inside
**that route's handler block** (split router text on `app.<method>(`); and a test
in `workers/**/*.onion-only.test.ts` naming the endpoint with **≥2 `expect(`**
and a **403**. Fixtures `{pass, fail-unguarded, fail-untested, fail-stale-route}`.

### 2. Compartments + one-shot identities
- `ACTIVE_COMPARTMENTS` → `['document','directory','medical','aid']`. Ordinals
  are append-only and must not move (`medical`=5, `aid`=6).
- `SIG_CONTEXT` gains `aidRequest`, `aidAccept` (keep `as const`, the
  `harborage/sig/` prefix and the `/vN` suffix or `gate-sig-context` fails).
- **`admitOneShot()` in `ratelimit.ts`, sharding by nonce prefix.**
  `admitCredential` addresses `cap:<certHashHex>`, so per-request certs would
  mint a fresh DO per request — an amplification vector, not a rate limit.
- First real consumer of `requestSeed`/`deriveRequestSeed`, unused since M2.
  `credential.ts` gains `oneShotCredentialHeaders` that **never caches**.

### 3. `Broker` + `Mailbox` DOs (api tag **v5**)
Already in `gate-memory-only`'s `WHOLLY_MEMORY`, so no gate edit — but see the
alarm finding below. One `Broker` per `(region_bucket, category)`; one `Mailbox`
per issued inbox token. **Every poll response padded to a fixed length**, so an
empty poll and a delivering poll are indistinguishable on the wire.
`inbox_token = HMAC(broker_epoch_secret, handle ‖ slot)`, verified before the
instance is addressed. New `ALG_BROKER_ONESHOT = 4` in `envelope.ts`, 4 KiB cap.
**No R2 path in M4** — an object per message is a durable record that an exchange
happened, in a store the memory-only gate does not cover. Defer it by name.

### 4. Aid routes (`aid_broker` flag)
`POST /api/aid/{offer,need,accept,poll}`, `aid` compartment. Three new
`SEALED-E2E` lanes in `tools/gates/sensitive-endpoints.json` plus fixture
families. Anti-honeypot: a need carries `H(secret)`; a responder is exposed only
after the preimage lands on a **second, separately-ticked** request; one
responder at a time; per-responder acceptance cap.

### 5. Medical routes (`medical_broker` flag), onion-only
`requireOnionOrigin` runs **first** — before the flag, before the credential,
before any binding is read. A clearnet request to a life-safety route must not
even cause a KV read. Makes `origin` a **required field on every**
sealed-endpoint registry entry (edit the two existing ones to `"any"`).

### 6. `skills_registry` + capacity bands (migrations 0019, 0020)
**No column from which a person could be reached**, and no route reads it row by
row. The only public read is a Cron-materialized **band (`NONE`/`SOME`/`MANY`),
never a count** — "two lawyers in this district" is a number small enough to act
on. New `gate-no-enumeration.mjs`. `PINNED_VETTING_ISSUERS` ships **empty**, so
every HIGH-tier offer refuses regardless of the flag (same structural pattern as
`PINNED_CUSTODIAN_KEYS`). Accommodation routes only through `entity_type='ORG'`.

### 7. Client aid surfaces + `gate-jit-briefing` + life-safety consumer
The briefing acknowledgement is **memory-only, never persisted** — persisting it
makes the briefing shown-once, the opposite of just-in-time. `/get-help/medical`
renders an **honest refusal** with a real alternative (112, `PUBLIC_INFRA` aid
stations), never a dead end or "coming soon". `workers/consumer` gains the
`life-safety` queue with its own DLQ; payloads carry **no user content**.

**Use `packages/crypto/src/sealed-box.ts`, not libsodium** — same construction,
stronger KDF binding, already in the frozen tested module, and it avoids pulling
300 KB of WASM onto a 2G phone at the moment someone is injured. ARCH §5.3 names
libsodium; correct it.

## M5 — Realtime + accountability (plan properly on arrival)

Read ARCH §6, §8. Order: **`gate-geo-granularity` first** (bans
`navigator.geolocation` anywhere under `apps/web/src`, any `lat`/`lng`/`coords`/
`gps*`/`precise_*` column, any geohash finer than 6) → pure HLL/bands/zone/quorum
modules → `LiveBoard` DO (api tag v7) → ingest + red-line conformance suite →
read path → WebSocket Hibernation → marshal quorum → accountability records +
claims → `ReviewGate` (console tag v3) → `DeadlineTimer` (api tag v8) →
incommunicado → client surfaces.

Load-bearing details: the density floor consumes the **HLL lower confidence
bound**, never the point estimate — a sketch reading 6 when the truth is 4
publishes exactly the signal suppress-until-safe-density exists to hide. **On
salt rotation, reset the sketch**: keeping it double-counts a reporter, and
inflation is the direction that pushes a small group over the floor. A zone id is
a member of a **pre-enumerated signed list**, not a computed geohash. Unquorumed
SAFE_EXIT is **withheld**, not shown greyed. Red line 2 is enforced by a **`CHECK`
constraint with no `PUBLISHED` value in the taxonomy**. Claims are `SEALED-E2E`
**to reviewer role box keys in `key_directory`, not to any platform key** — M4 and
M5 together must add **zero platform unseal keys**. `detainee_intake` joins
**`LOCKED`**, not `FLIPPABLE`.

## DECISIONS ALREADY TAKEN (do not re-open)

- **A wholly-memory DO CANNOT arm an alarm.** `gate-memory-only`'s `STORAGE_RE`
  matches `ctx.storage` and `\.storage\.`, and `setAlarm()` is the only alarm
  API. The gate is substantively right: `setAlarm()` bills as a row written, so
  an alarm **is** durable state, and an alarm row is a PITR-visible record that
  something is pending at time T. **Do not edit the gate.** `Broker`, `Mailbox`,
  `LiveBoard`, `CoordinationWindow` use lazy expiry (the `RateLimit` pattern) plus
  a **tick grid computed from `Date.now()` inside the in-flight long-poll** — the
  puller's own open request is the clock. **Correct ARCH §15 "discarded on
  alarm", §5.3/§18.3 "jittered alarm tick" and §6 as each class lands.**
- **Compartment enum is closed, 8 entries, ordinals append-only** (they go on the
  wire): `document(0) directory(1) community(2) accountability(3) curation(4)
  medical(5) aid(6) legal(7)`.
- **Cap-cert is self-issued and authorises nothing.** Sybil resistance is
  Turnstile + rate ladder + reputation, never the cert.
- **Tier B vault custody is XOR-split, not plain Shamir** (§5.4 corrected).
- **pHash is client-side, advisory only.** Workers cannot decode pixels;
  `env.IMAGES.info()` returns no pixels and is free.
- **Archive master is WebP, not AVIF** (§16 Lever 2 corrected). The live limits
  table lists "AVIF | 1,200 pixels" ambiguously against the 1,280 px legibility
  floor. One constant away if someone measures it.
- **OpenTimestamps: adopt no library.** Both candidates stale, both newer ones
  single-maintainer sub-1.0. Submit-only stub behind `archive_anchoring` (OFF).
- **Bucket Lock / replication are not built.** `gate-archive-custody` makes that
  structural: no column may express custody nobody can undo.
- **UI/route/flag vocabulary is "document"**, not "record" or "report".

## NON-NEGOTIABLE GUARDRAILS

The three red lines (no public target list; no unverified plainclothes identity
claims; no live or persistent individual location). AI and community emit ONLY
`{label, rank, hide-pending, retain-pending, route-to-gate}`. Autonomous ceiling
`Community-Corroborated` with capped sub-amplification; `Human-Verified` is
Layer-B only. No member directory or enumeration endpoint, no social/vouch graph,
no identity↔pseudonym map, no subscriber roster, no real-name/phone/SIM/OTP
identity or recovery. Sensitive data sealed client-side; intake rejects non-sealed
bodies; the platform holds no key and no unwrap endpoint for E2E classes. Coarse
geo only. Redaction irreversible, fail-closed to vault-only. Retention honestly
qualified against PITR/Time-Travel. `safeLog` only, no query logging. Every
data-holding feature behind a fail-closed flag; heightened-threat tightens only.
Memory-only DOs never touch DO storage OR D1 OR R2 OR WebSocket attachments.

**Honesty is a correctness property, not a tone preference.**

## BUILD GOTCHAS (hard-won — these will bite again)

**Sabotage every safety test before trusting it.** Session 10 found six real
bugs this way and **zero** by reading. Three were tests green for the wrong
reason.

- **A route behind a per-request credential returns 401/403 before reaching the
  code under test.** Three tests asserted `not.toBe(200)` or intercepted `fetch`
  and stayed green when the guarded code was deleted. Two fixes: put **structural
  validation first** (before the credential) and assert the **exact** status; or
  move the claim into a **gate**, which refuses the code's *existence* rather than
  its reachability.
- **Check EXIT CODES, never `grep -c` on output.** `pnpm typecheck 2>&1 | grep -c
  ERRORS` returns 0 when the run fails *before* reaching the matched line. That is
  how a `node:fs/promises` typecheck break reached CI. Use
  `cmd >/dev/null 2>&1; echo $?`.
- **`gate-sealed-body` scans COMMENTS.** A comment cannot spell out
  `*_SECRET_KEY` / `*_PRIVATE_KEY` even to say they were avoided — same trap as a
  migration comment that cannot say "no payment field".
- **Workers tsconfigs have no node types.** A test cannot `import('node:fs')` or
  use `import.meta.url`. Static source checks belong in a `.mjs` gate.
- **A DO test stub must run `exec` EAGERLY.** Deferring to `.toArray()` means the
  constructor's `CREATE TABLE` never runs, because nothing reads it.
- **An unlinked prerendered route must be named in `prerender.entries`**
  (`apps/web/svelte.config.js`) or the build fails: the crawler cannot find it.
- **e2e vault stubs** must serve parts from `*.r2.cloudflarestorage.com` (the only
  host in `connect-src`) and set `Access-Control-Expose-Headers: ETag`, or every
  multipart is uncompletable. Dropping that header is a good check the stub is real.
- **Local e2e flake is pre-existing.** `main` itself fails 2–3 of
  `redaction-pixels` / `share-pack` / `qa-sweep` per run. **Verify against `main`
  before chasing.** CI retries twice and is green.
- **Stacked branches need rebasing after each merge**, or the PR shows
  CONFLICTING with no CI at all.
- Run the FULL `pnpm typecheck && pnpm build && pnpm gates && pnpm pack:verify &&
  pnpm test` before every commit. **RUN THE APP** for anything web-facing
  (`pkill -f "wrangler dev"` first). `wrangler deploy --dry-run` before pushing
  binding changes.
- `gate-selftest` requires every gate to have
  `tools/gates/fixtures/<gate>/{pass,fail*}/` with **several** `fail-<reason>/`
  trees — one shared fixture only proves whichever check fires first — and the
  `pass/` tree must **exercise** the feature, not merely avoid the failure.
- `gate-action-vocabulary` uses substring matching inside
  `packages/worker-lib/src/verification/`: `delete` (incl. `Map.delete`),
  `reveal*`, `purge`, `erase`, `destroy`, `publish` all fail. (`identifier` and
  `identity` do **not** contain `identify` — an earlier note was wrong.)
- `gate-ai-tells` scans `content/` + `apps/*/messages/` in EN and HI. No em-dash,
  no `!`, no `submit`/`feed`/`blur`/`panic`/`just`/`simply`/`easily`. **Message
  JSON files are in authoring order, not sorted** — insert new keys in place.
- **`@noble/curves` P-256 verify needs BOTH `prehash: false` AND `lowS: false`.**
- Importing the `@harborage/crypto` **barrel** into a Workers-typed package fails
  tsc. Use subpath exports.
- **The Bash tool's cwd persists between calls.**
- New DO class ⇒ new wrangler migration tag (**never edit a deployed tag**) +
  re-export from the worker entry + `ApiEnv` field + `gate-memory-only`
  classification.
- `deploy.yml` order is console → web → api → media → **consumer last**.
- New infra resource ⇒ new `infra/outputs.tf` output ⇒ new `REPLACE_*` sed.
  (The Images binding was an exception: no resource id.)
- **NO SEED DATA.** Migrations have zero INSERTs; production D1 stays at zero rows.

## WORKING STYLE

Verify every Cloudflare limit / model / API shape and every library version
against **live** sources. Small, signed, type-prefixed commits, **no attribution
trailer**. Branch off main → PR → CI green → rebase-merge. PR bodies explain
**why**, including what you rejected. If you find a bug in existing code, fix it
and say so.

**Prefer adding a CI gate over adding a comment. Negative-test every new gate.**

After each merge, approve the production deploy and tell me the run id. Approve
gate 1 without ceremony; **read the plan before approving gate 2**. Approvals:

```bash
gh api -X POST repos/cockroach-harborage/harborage/actions/runs/<RUN>/pending_deployments \
  --input - <<'EOF'
{"environment_ids":[18534075991],"state":"approved","comment":"..."}
EOF
```
(The `-f "environment_ids[]=..."` form fails with HTTP 422.)

**Nothing blocks you.** `docs/maintainer-walkthrough.md` Part 2 §2.5–2.6 and
Part 3 hold every deferred manual item, each blocking one flag rather than any
build. If something is unsafe, creates a compellable record, crosses a red line,
or needs counsel — stop and ask, and choose the safer, less-data default.

**Start with `gate-onion-only`, and remember that `Broker` cannot arm an alarm.**
