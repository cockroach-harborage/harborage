# Session prompt — finish M3, then M4, then M5

Continue building Harborage (repo: `/Users/ameenahsan/projects/cockroach-app`) —
Cloudflare-native civic infrastructure for peaceful, lawful protest and
human-rights documentation in India. Read `CLAUDE.md`, `PRD.md`,
`ARCHITECTURE.md` first (source of truth; **ARCH §18 overrides earlier
sections**, §14/§18.3 authoritative on version pins, and for the client media
pipeline **§19 overrides §7.5 overrides §7.1**). Read the auto-loaded memory
(`harborage-project.md`, `harborage-m2-complete.md`, `harborage-m3-evidence.md`)
for current state and build gotchas.

## GOAL THIS SESSION

**Finish M3 (Evidence), then build M4 (Brokered aid), then M5 (Realtime +
accountability)** — as much as possible, all behind fail-closed flags. Do the
heavy lifting. I am a solo maintainer and will not review every line: take
ownership, make the routine calls yourself, and stop only for things that
genuinely need me (a red line, legal exposure, product naming, anything that
changes what a user is promised, or a manual step you cannot perform).

You have Cloudflare MCP, `gh` for both accounts, and permission to approve
production deploys. Don't wait for me on anything you can do yourself.

## CURRENT STATE (verified 2026-07-25, end of session 9)

`main` = `6031865`, working tree clean, **deployed and live** at
`cockroachharborage.org`.

**M0 + M1 + M2 complete. M3 is roughly half done** (PRs #50–#54, all merged and
deployed). Baseline:

- **13 CI gates**, **387 unit tests**, **48 e2e** — all green
- Production D1: **13 migrations, zero rows in every table**
- **Every feature flag OFF**

Packages: `apps/{web,console}`, `workers/{api,media,consumer}`,
`packages/{crypto,worker-lib,outbox,foundry}`, `infra/` (26 tofu resources),
`tools/gates` (13), `tools/plan-guard`.

Tests by package: crypto 109, worker-lib 86, web 68, media 30, consumer 28,
api 24, outbox 25, console 17.

**DO classes:** `FlagState`, `NoticeLog` (console, tags up to **v2**);
`RateLimit`, `VerificationState`, `SpendCap`, `ReReviewQueue` (api, tags up to
**v3** — next is **v4**).

**Flags** (`packages/worker-lib/src/flags.ts` + `apps/console/src/flag-policy.ts`
— you must edit **both**): `heightened_threat`, `notices_publish`,
`directory_intake`, `document_intake`, `evidence_vault`, `incidents_publish`,
`ai_moderation`, `community_corroborate`, `archive_anchoring`.

**Crypto subpath exports:** `. ./canary ./cap-cert ./compartments ./device-keys
./hkdf-tree ./minisign ./mnemonic ./notice ./pack ./sealed-box ./shamir
./signature ./sodium ./vault-key`
**worker-lib exports:** `. ./types ./safe-log ./flags ./access ./envelope
./turnstile ./cap-cert ./ratelimit ./verification ./reputation`

**Migrations end at `0013_evidence_keyrings.sql`.** Next is `0014`.

**Routes today.** api: `POST /api/incidents/register`,
`POST /api/evidence/keyring`, `POST /api/directory/report`,
`GET /api/incidents/index`, `GET /api/notices`, `GET /api/directory/pack`,
`GET /api/intake/status`. media: `/media/{create,part,complete,abort,head,derivative}`,
**all six now behind cap-cert + PoP**.

**Sealed-endpoint registry** (`tools/gates/sensitive-endpoints.json`):
`POST /api/incidents/register` = SEALED-TO-PLATFORM on lane
`incident-metadata-envelope`; `POST /api/evidence/keyring` = SEALED-E2E on lane
`evidence-content-key`.

### What session 9 built that you build on

- **`gate-sealed-body` is lane-scoped** (#50). Every entry names a required
  `sealed_object`. A `platform_key` opens only its own entry's lane. A
  SEALED-E2E entry fails if a registered key opens ITS lane, **or** if any
  unseal-shaped binding is unregistered anywhere. That second rule is what stops
  the scoping being an escape hatch — do not weaken it.
- **The §19 client pipeline** (#51). `apps/web/src/lib/pipeline/`:
  `image-header.ts` (intrinsic dimensions with no decode), `derivative-core.ts`
  (pure sizing/geometry/coverage arithmetic), `pipeline.worker.ts` (one render,
  confirm-on-final-bytes), `ConfirmDerivative.svelte`. `documents.ts` is at IDB
  **v2** with a `capture-quarantine` store.
- **`packages/crypto/src/vault-key.ts`** (#52). Tier A and Tier B CEK custody.
  `PINNED_CUSTODIAN_KEYS` is **empty**, so every wrap refuses.
  `POST /api/evidence/keyring` is the SEALED-E2E lane; the consumer stores the
  blob verbatim via `recordKeyring` and cannot open it.
- **Media credentials + four upload bugs fixed** (#53). `OriginalStatus` gained
  `none`. `MultipartCursor.bucket` is now the real bucket name.
- **Turnstile, live** (#54). `infra/turnstile.tf`, sitekey served from
  `GET /api/intake/status`, secret piped into `wrangler secret put` by the deploy
  job. `TurnstileWidget.svelte` uses a **named `turnstile-script` Trusted Types
  policy** that ignores its argument and returns one hardcoded constant.

## SEQUENCING (settled — do not re-litigate)

**Finish M3 → M4 → M5.** Build-first per ARCH §18.2: the build is never gated,
only the switch-on is. Every human/legal gate (offshore custodians, counsel
sign-off, APK, redaction-review humans, m-of-n reviewers) is deferred until
after the full feature build, because I am solo until then.
`docs/maintainer-walkthrough.md` holds my manual steps; none block you.

Carry this without engineering around it: **M3 is where the largest share of
built-but-unflippable code accumulates.** Build it, wire it, test it, ship it
OFF. Do not lower a bar to make something demonstrable.

## M3 — what is left

Suggested order; resequence if you find a better one, and say why.

### 1. The outbox runner — the engine exists and nothing drives it

`packages/outbox` has `nextEarliestRetry`, `maxAge`, `attempts`,
`fullJitterDelay()` and `concurrencyFor()` all written and **never consumed**. A
killed upload persists and is never picked back up, and every upload runs
serially regardless of link. Build `apps/web/src/lib/outbox-runner.ts`:

- flush on the `online` event and on `visibilitychange → visible` (**the only
  reliable trigger on iOS PWAs**, §19:1304), plus a manual "try now"
- exponential backoff with full jitter; honour `nextEarliestRetry` and `maxAge`
- concurrency by link class (serial on 2G — parallel parts there cause
  congestion collapse)
- cancel (best-effort `AbortMultipartUpload`, delete the row, wipe the blob)
- `navigator.storage.persist()` + quota check at enqueue, with the plain warning
  from §19:1262 that a not-yet-vaulted original exists only on this phone
- honest per-item progress copy (§19:1300), and `original_status` surfaced

**Prove resume across a restart and a link-class change** in a real browser, and
prove a forced 429 on complete does **not** restart the multipart (#53 fixed
that mapping; add the regression test).

### 2. Panic-wipe (§19:1302)

`documents.wipeAll()` still has **no caller**. `identity.wipe()` is deliberately
identity-only — read the comment before you touch it; one button that silently
destroys everything is how people lose evidence they meant to keep. So this is a
**missing separate affordance**, not a bug in the existing one. Add it on
`/settings/safe-mode`: clears documents, quarantine, outbox rows, cipher blobs,
SW caches and IndexedDB, with copy that states plainly that a not-yet-vaulted
original is destroyed. EN + HI.

### 3. `CustodyChain` DO + §63 BSA export

`workers/api/src/do/CustodyChain.ts`, api wrangler tag **v4**. Already
classified `SQLITE_OK` in `gate-memory-only`, so no gate edit.

- fixed 8-event vocabulary: `ingest, redact, admit, probation-clear, lock,
  replicate, dispute, tombstone`
- `record_hash = SHA256(prev_hash ‖ canonicalJson(record))` — reuse
  `canonicalJson` from `@harborage/crypto/pack`
- Merkle checkpoints every 64 entries or daily; **cohort-≥K or randomized delay
  before inclusion** (§16:970) so a singleton submitter gets no timing oracle
- no deanonymizing fields: no IP, no device, no real name, actor = pseudonymous
  role/band only
- **export gated on `original_status = 'vaulted'`** (§19:1261). A hash
  registered without vaulted bytes is explicitly the weaker claim and the export
  must say so.
- "preservation supporting lawful processes, **not** an admissibility
  guarantee", in the artifact and on `/limits`
- `/archive/verify`: a static client-side inclusion-proof verifier (hash →
  custody record → Merkle path → anchor) that trusts nothing of ours
- `archive_anchoring` stays OFF; OTS anchoring is a stub — §18.4 records that
  both candidate JS libraries are unmaintained and the choice is re-taken here

### 4. Archive tables, dedup, fail-closed admission

Migrations **0014–0017** + inverses: `perceptual_hashes`, `archive_items`,
`archive_provenance`, `archive_disputes`.

- **64-bit dHash over the derivative only**, computed client-side (Workers
  cannot decode pixels, §14:615; `env.IMAGES.info()` returns no pixels). It is
  attacker-controlled, so it is advisory/presentation-only and recomputable
  server-side later — say so.
- **Banded LSH** as four indexed 16-bit band columns for candidate lookup, then
  exact Hamming in the Worker. **Never Vectorize** (§14:680 — cosine/euclidean/
  dot only, no Hamming). Vectorize does not exist in `infra/` and M3 does not
  need it.
- **Perceptual matching never deletes an object.** Exact-byte dedup collapses
  storage; perceptual dedup collapses *presentation*. Two different-angle videos
  of one event are distinct evidence.
- Vault-original fingerprints **never** enter plaintext D1 (§16:1037) — that
  would be a content-existence oracle over unreadable content.
- Cohort-gated `derivative_held: skip|upload` on register. **Never** a HEAD on
  the sealed original's hash; convergent encryption is explicitly rejected.
- Probation window state machine (30–90 d, counsel-set) with continuous
  re-scan. New `archive_publish` flag, OFF.
- `HRB-<base32(sha256(original)[:10])>` citable id.
- Append-only disputes; Debunked withdraws **local** display and keeps the
  tamper-evident record that it existed and was retracted.
- **Do not build Bucket Lock application.** §16 makes it counsel-gated and
  post-probation; a lock applied before certainty turns any detection miss into
  permanently un-purgeable illegal content. The purge-override maps to the
  existing LOCKED `permanent_delete`.

### 5. The corroboration-reach machinery (§15, §18.1 puts it at M3)

`workers/api/src/do/CoordinationWindow.ts` — api tag **v5**. Already in
`gate-memory-only`'s `WHOLLY_MEMORY` list.

- behaviour-only clusters (ASN bucket, timing burst, device class,
  stylometry-lite, template similarity), scoped to the item's window and
  **discarded on alarm**
- `packages/worker-lib/src/verification/independence.ts`: `K_src`, `clusterCap`,
  **diversity-of-corroboration-history weighting** (accounts that have never
  before co-appeared count more than raw earned scalar), **cohort-pivot
  detection** (a long unrelated history suddenly co-corroborating one hot item
  is itself a coordination signal, even with no burst)
- `reachMachineryEnabled` becomes driven by `community_corroborate`
- conformance tests §18.5-P2: the reach table, "a flag storm cannot bury truth",
  "a mob cannot verify a falsehood cheaply", a Sybil/CIB simulation, and the
  guard that no code path reaches an irreversible verb

**You will be tempted to persist cluster state so it survives an eviction.
Don't.** No co-witness or social graph is ever persisted (§15:819), and
`gate-memory-only` will stop you. The correct answer is to accept the eviction,
not to edit the gate.

### 6. Server-side AVIF master + source-media import

- `env.IMAGES` on `workers/media`, reading the derivative and writing the AVIF
  master back **over the presign path media already has** — so no R2 binding and
  **no `HB_DEPLOY_TOKEN` scope change**. 20 MB input ceiling; oversized → skip,
  not fail. Behind `archive_publish`, so zero transformations are billed until
  switch-on. **Tell me one PR ahead**: a new binding can fail deploy with
  Cloudflare error 10000, same class of risk as Workers AI.
- `source_import` flag + **fingerprint-and-reference only**: store the
  user-supplied canonical content ID and the client pHash. **No fetch** — the
  off-platform Tor egress box does not exist, and re-hosting is the
  counsel-gated (#14 ToS) step.

### 7. Video poster keyframe (§7.5:334–338, §19:1310–1315)

The app accepts images only today. Video needing redaction **fails closed to
SEALED_ONLY**; the only day-1 public artifact is a **redacted poster keyframe**
run through the existing still pipeline. Poster generation is fallible
(iPhone HEVC and some high-bitrate H.264 will not decode in Android WebView) —
probe the decode and **fail closed with explicit copy**, never a silent missing
poster. The copy must say plainly that the video's faces are **not** covered and
it stays sealed. Do not imply a server-produced face-covered video will ever
arrive; §7.5 is explicit that it will not.

## M4 — Brokered aid (plan properly on arrival)

Read ARCH §5.3, §9.2, §9.3. Medical / mutual aid / assistance on **sealed-box
one-shot** (`crypto_box_seal`; libsodium is fine here, it sits behind the vault,
not on first paint — `packages/crypto/src/sodium.ts` is the lazy loader).
`Broker`/`Mailbox` memory-only routing + R2 ciphertext, late reveal,
anti-honeypot, **jittered alarm-tick delivery**. Medical and detention are
**onion-only and must refuse over clearnet**. `skills_registry` is brokered,
**never browsable**. First real use of `requestSeed` per-request identities
(already in `hkdf-tree.ts` and `device-keys.ts`, still unused). Prekey fetches
are never persisted. Widen `ACTIVE_COMPARTMENTS` to add `medical`/`aid`.
`Broker`/`Mailbox` are already in `gate-memory-only`'s `WHOLLY_MEMORY` list.

## M5 — Realtime + accountability (plan properly on arrival)

Read ARCH §6, §8. `LiveBoard` (sharded HLL, memory-only, already classified),
zone-level **never finer than geohash-6**, delayed (base + jitter),
**density-floored with suppress-until-safe-density**, coarse crowd **bands never
counts**, short-TTL, **memory-only — never DO SQLite or D1**. `DeadlineTimer`
(SQLite, content-free payloads). Accountability records + `ReviewGate` DO
(console-hosted) + detainee tracker. **Every irreversible gate ships OFF behind
an unsatisfiable quorum.** The facilities layer is precise but **physically
segregated** so it can never be joined to protestor density.

## DECISIONS ALREADY TAKEN (do not re-open)

- **Compartment enum is closed, 8 entries, ordinals append-only** (they go on the
  wire): `document(0) directory(1) community(2) accountability(3) curation(4)
  medical(5) aid(6) legal(7)`.
- **Cap-cert is self-issued and authorises nothing.** Sybil resistance is
  Turnstile + rate ladder + reputation, never the cert.
- **No media "upload ticket".** §7.6 sketches one; the cap-cert + PoP already in
  the codebase does the job with no new shared secret and no new state. Recorded
  in ARCH §7.6.
- **Tier B vault custody is XOR-split, not plain Shamir.** §5.4's literal
  "Shamir 2-of-3" cannot express "the offshore share is mandatory in every
  quorum" — 2-of-3 over {reporter, lawyer, offshore} is satisfied by the two
  domestic holders. Ships as `CEK = K_offshore XOR K_domestic`. §5.4 corrected.
- **pHash is client-side, advisory only.** Workers cannot decode pixels.
- **Turnstile is Managed mode, not Invisible**, and `feedback-enabled` is false.
  An invisible widget fails Tor and VPN users silently with no recovery path.
- **Backup words are erased by default** after the user re-types 3 of 12.
- **UI/route/flag vocabulary is "document"**, not "record" or "report"
  (PRD.md:830 — रिपोर्ट करना reads as filing an FIR).

## NON-NEGOTIABLE GUARDRAILS

The three red lines (no public target list; no unverified plainclothes identity
claims; no live or persistent individual location). The reversible/irreversible
line: AI and community emit ONLY `{label, rank, hide-pending, retain-pending,
route-to-gate}`. Autonomous ceiling `Community-Corroborated` with capped
sub-amplification; `Human-Verified` is Layer-B only. Structural invariants: no
member directory or enumeration endpoint, no social/vouch graph, no
identity↔pseudonym map, no subscriber roster, no real-name/phone/SIM/OTP
identity or recovery. Sensitive data sealed client-side; intake rejects
non-sealed bodies; the platform holds no key and no unwrap endpoint for E2E
classes. Coarse geo only. Redaction irreversible, fail-closed to vault-only.
Retention honestly qualified against PITR/Time-Travel. `safeLog` only, no query
logging. Every data-holding feature behind a fail-closed flag; heightened-threat
tightens only. Memory-only DOs never touch DO storage OR D1.

**Honesty is a correctness property, not a tone preference.**

## BUILD GOTCHAS (hard-won — these will bite again)

**Test your safety tests by breaking the thing they guard.**
Twice in session 9 a test of mine was green for the wrong reason, and both were
found by deliberate sabotage, not by reading:

- The cover-verification inset by **8% of the box**. Fine on a small box; on a
  700px box it skips a 56px band *inside* the confirmed region. A 6px paint
  offset changed nothing. Now a fixed 3px, and strided sampling always includes
  the last index on each axis or the bottom and right edges go unchecked.
- A Turnstile e2e passed because the **script was blocked**, not because the
  error callback fired. Only visible because a sibling test proved the same stub
  does load.

Before trusting any new guard: break the invariant, watch it fail, restore.

**Process**
- Run the FULL `pnpm typecheck && pnpm build && pnpm gates && pnpm pack:verify
  && pnpm test` before every commit. A per-filter typecheck has missed a CI
  failure.
- **RUN THE APP.** `pnpm --filter @harborage/web exec playwright test` for
  anything web-facing; `wrangler deploy --dry-run` before pushing binding
  changes. Kill orphaned `wrangler dev` first (`pkill -f "wrangler dev"`) —
  local e2e flake is almost always that, and `share-pack` is the usual victim.
  CI retries twice.
- **The Bash tool's cwd persists between calls.** A stray `cd apps/web` silently
  breaks every later relative path. Use absolute paths or `cd` back.
- `gitleaks` scans every commit in the PR range, not the final tree, so a fixed
  false positive still fails until the branch is squashed. Its `generic-api-key`
  rule fires on an expression that merely *looks* like assigning a long value to
  a key-ish identifier — restructure rather than adding a suppressions file.
- `zizmor` collects `**/.github/workflows/*.yml` including fixtures.
- **Branch before you build.**

**Gates**
- `gate-selftest` requires every `gate-*.mjs` to have
  `tools/gates/fixtures/<gate>/{pass,fail*}/`. Use several `fail-<reason>/`
  trees — one shared fixture only proves whichever check fires first. **The
  `pass/` fixture must exercise the feature too**: when the sealed-body gate was
  relaxed, `pass/` had to gain a SEALED-E2E lane or the relaxed path was never
  tested.
- `gate-memory-only` keys off the DO file's **basename**, fails unclassified
  classes, and scans **inside comments**. Its D1 matcher is `\b`-anchored on the
  literal token `DB`, so a differently-named D1 binding would evade it.
- `gate-schema` and `gate-memory-only` grep **inside SQL comments**.
  `gate-d1-index` fails any Worker query filtering an unindexed column and
  **does not parse table-level `UNIQUE`** — use a standalone
  `CREATE UNIQUE INDEX`.
- `gate-ai-tells` scans `content/` + `apps/*/messages/` in EN and HI. No
  em-dash, no `!` anywhere, no "submit", no "feed", no "blur", no
  "just/simply/easily". It does **not** scan `docs/`.
- `gate-action-vocabulary` uses **substring** matching, so `delete`, `identify`
  and `reveal` are banned inside `packages/worker-lib/src/verification/` even as
  part of a longer word.
- `gate-sealed-body` needs ≥2 assertions + a 4xx + a live route per endpoint,
  every unseal-shaped binding registered, and every entry carrying a
  `sealed_object`.

**Crypto**
- Importing the `@harborage/crypto` **barrel** into a Workers-typed package
  drags `seal.ts` → `globalThis.crypto` into tsc and fails. Use subpath exports.
- **`@noble/curves` P-256 verify needs BOTH `prehash: false` AND `lowS: false`.**
  At the defaults it fails ~50% of the time. Any test touching ECDSA must loop.
- Every signature takes a mandatory `SigContext` from `SIG_CONTEXT`.

**Web**
- CSP lives in `apps/web/svelte.config.js` **and** `apps/web/_headers`, and the
  two are enforced independently. `_headers` deliberately carries no
  `script-src`/`default-src`. `connect-src` must keep
  `https://*.r2.cloudflarestorage.com`; both now also allow
  `https://challenges.cloudflare.com` in `script-src`/`frame-src` — **one exact
  host, no wildcard**, and an e2e asserts it stays that way.
- **`HTMLScriptElement.src` IS a TrustedScriptURL sink.** With
  `require-trusted-types-for 'script'` enforced, a plain-string `.src` throws and
  a third-party script silently never loads. The `default` policy in
  `pipeline-client.ts` rejects cross-origin by design and cannot rescue it. The
  pattern is a **named** policy that ignores its argument and returns one
  hardcoded constant, allow-listed by name in `trusted-types`.
- **CSP blocks `fetch()` on the page's own `blob:` URL.** Do not widen
  `connect-src` for a test — read committed bytes from IndexedDB instead, which
  is the stronger assertion anyway.
- `new Worker(new URL(...))` needs the same-origin default TT policy and Vite
  requires the literal form.
- Svelte 5 `$state` proxies are NOT structured-cloneable — snapshot before
  `postMessage`/`IndexedDB.put`. Naming a variable `state` shadows the rune.
- `apps/web/vitest.config.ts` includes only `test/**`, with no `$lib` alias and
  no DOM — anything unit-tested there must import nothing (the `*-core.ts` split
  pattern).
- **Message JSON files are in authoring order, not sorted.** Insert new keys in
  place; a global sort produces a 500-line unreviewable diff.
- Every route is prerendered: IndexedDB must be lazily opened.

**Cloudflare / CI**
- New DO class → new wrangler migration tag (**never edit a deployed tag**) +
  re-export from the worker entry + classify in `gate-memory-only`.
- `deploy.yml` order is console → web → api → media → **consumer last**.
- **The `~> 5.22` provider nulls server-defaulted optional attributes on
  re-apply and the API rejects a null bool**, breaking every deploy after the
  first. Every optional+computed attribute on a new resource needs
  `ignore_changes`. This is why `cloudflare_ai_gateway`, `cloudflare_d1_database`
  and `cloudflare_turnstile_widget` all carry it.
- New infra resource ⇒ new `infra/outputs.tf` output ⇒ new `REPLACE_*` sed in
  `deploy.yml`.
- Deploys are `plan → apply → deploy`, all three gated on `production`. **All
  three must stay gated** (every secret is environment-scoped; an ungated job
  reads them as empty). Approve gate 1 without ceremony; **read the plan before
  approving gate 2**. `tools/plan-guard` fails on any destroy or replace.
- **`HB_TERRAFORM_TOKEN` now has Turnstile:Edit** (added 2026-07-25).
  **Workers AI and the Images binding are still untested** — bind either in its
  own small PR and tell me one PR ahead.
- The shell is **zsh**: unquoted `$VAR` does NOT word-split.
- **NO SEED DATA.** Migrations have zero INSERTs, production D1 stays at zero
  rows, demo data only via Playwright route interception.

## WORKING STYLE

Verify every Cloudflare limit / model / API shape and every library version
against **live** sources — the training cutoff is stale and in-repo docs drift.
For a Terraform resource schema, `tofu providers schema -json` in a scratch
directory is authoritative and faster than the registry docs. When a doc and a
live source disagree, the live source wins and you update the doc in the same
commit.

Small, signed, type-prefixed commits, **no attribution trailer**. Branch off
main → PR → CI green (`ci`, `e2e`, `zizmor`, `gitleaks`, `tofu-validate`) →
rebase-merge for linear history. PR bodies explain **why**, including what you
rejected and why. If you find a bug in existing code, fix it and say so.

**Prefer adding a CI gate over adding a comment. Negative-test every new gate.**

After each merge, approve the production deploy, cancel superseded waiting runs,
and tell me the run id.

If something is unsafe, creates a compellable record, crosses a red line, or
needs counsel — stop and ask, and choose the safer, less-data default. Shipping
the unsafe version is worse than shipping late.

**Start with the outbox runner, and read the panic-wipe note before you touch
`identity.wipe()`.**
