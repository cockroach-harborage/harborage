Continue building Harborage (repo: `/Users/ameenahsan/projects/cockroach-app`) — Cloudflare-native civic infrastructure for peaceful, lawful protest and human-rights documentation in India. Read `CLAUDE.md`, `PRD.md`, `ARCHITECTURE.md` first (source of truth; ARCH §18 overrides earlier sections, §14/§18.3 authoritative on version pins). Read the auto-loaded memory (`harborage-project.md`, `harborage-m2-complete.md`) for current state and build gotchas.

## GOAL THIS SESSION

Build **M3 (Evidence)**, then **M4 (Brokered aid)**, then **M5 (Realtime + accountability)** — as much as possible, all behind fail-closed flags. Do the heavy lifting. I am a solo maintainer and will not review every line: take ownership, make the routine calls yourself, and stop only for things that genuinely need me (a red line, legal exposure, product naming, anything that changes what a user is promised, or a manual step you cannot perform).

You have Cloudflare MCP, `gh` for both accounts, and permission to approve production deploys. Don't wait for me on anything you can do yourself.

## CURRENT STATE (verified 2026-07-25, end of session 8)

`main` = `43930cc`, working tree clean, **deployed and live** at `cockroachharborage.org`.

**M0 + M1 + M2 are all complete.** Baseline:
- **13 CI gates**, **326 unit tests**, **37 e2e** — all green
- Production D1: **12 migrations, zero rows in every table**
- **Every feature flag OFF**

Packages: `apps/{web,console}`, `workers/{api,media,consumer}`, `packages/{crypto,worker-lib,outbox,foundry}`, `infra/` (25 tofu resources), `tools/gates` (13), `tools/plan-guard`.

Tests by package: crypto 95, worker-lib 86, web 40, consumer 23, media 21, api 20, console 17, outbox 24.

**DO classes that exist:** `FlagState`, `NoticeLog` (console); `RateLimit`, `VerificationState`, `SpendCap`, `ReReviewQueue` (api). api wrangler migration tags go up to **v3** — the next one is **v4**.

**Flags:** `heightened_threat`, `notices_publish`, `directory_intake`, `document_intake`, `incidents_publish`, `ai_moderation`, `community_corroborate`, `archive_anchoring`. All OFF. Adding one means editing **both** `packages/worker-lib/src/flags.ts` (the `FlagName` union) and `apps/console/src/flag-policy.ts` (`FLIPPABLE`).

**Crypto subpath exports:** `. ./canary ./cap-cert ./compartments ./device-keys ./hkdf-tree ./minisign ./mnemonic ./notice ./pack ./sealed-box ./signature ./sodium`
**worker-lib exports:** `. ./types ./safe-log ./flags ./access ./envelope ./turnstile ./cap-cert ./ratelimit ./verification ./reputation`

**Migrations end at `0012_review_approvals.sql`.** Next is `0013`.

### What M2 built that you will build on

- **On-device identity** (`apps/web/src/lib/identity.ts` + `identity-core.ts`): BIP39 → non-extractable WebCrypto HKDF root → per-compartment Ed25519/X25519, 4th IndexedDB `harborage-identity`, three-tier custody ladder, real `/settings/identity`.
- **Cap-cert + per-request PoP** (`packages/crypto/src/cap-cert.ts`, `packages/worker-lib/src/cap-cert.ts`): self-issued, authorises nothing, wired at `POST /api/incidents/register` and `/api/directory/report`.
- **Rate ladder** (`packages/worker-lib/src/ratelimit.ts`): 16 global shards + per-ASN in parallel, then per-cap-cert which also holds the PoP nonces.
- **Sealed-box** (`packages/crypto/src/sealed-box.ts`): ephemeral X25519 → HKDF → XChaCha20. Currently used SEALED-TO-PLATFORM for the register body.
- **`openChunks`** (`packages/outbox/src/chunked-cipher.ts`): the inverse of `sealChunks`, deriving `total` from ciphertext length. **M3's vault restore depends on this.**
- **§15 state machine** (`packages/worker-lib/src/verification/machine.ts`): pure, no imports. 8 states, canonical reach table, closed 5-verb action enum, `reachMachineryEnabled: false` pins the ceiling at `AI-Screened`.
- **Reputation inputs** (`packages/worker-lib/src/reputation.ts`): √-damping, `clusterCap`, `r_gate`, decay, `dedupToken`. Nothing multiplies into reach yet — **that is M3's job.**
- **Consumer** (`workers/consumer`): explicit ack/retry, DLQ, Tier-0 from `RULESETS` KV, first writer of `incidents`.
- **Console review queue**: two distinct Access subjects for `Human-Verified`.

## SEQUENCING (settled — do not re-litigate)

**M3 → M4 → M5.** Build-first per ARCH §18.2: the build is never gated, only the switch-on is. Every human/legal gate (offshore custodians, counsel sign-off, APK, redaction-review humans, m-of-n reviewers) is deferred until after the full feature build, because I am solo until then. `docs/maintainer-walkthrough.md` holds my manual steps; none block you.

Carry this without engineering around it: **M3 is where the largest share of built-but-unflippable code accumulates.** ARCH §12 gates the evidence tier on off-platform custodians and an APK for the highest-risk capture tier. Build it, wire it, test it, ship it OFF. Do not lower a bar to make something demonstrable.

## M3 — Evidence

Read ARCH **§7.1–7.6** (capture→redact→vault, custody ledger, source import, client pipeline), **§16** (archive), **§19** (low-bandwidth upload), and **§5.4** (vault key custody).

Suggested slice order — resequence if you find a better one, and say why:

1. **Redaction, properly.** `apps/web` already has `RedactionCanvas.svelte` and the capture Web Worker. Make redaction **irreversible solid-fill** with mandatory human before/after confirm, **failing closed to vault-only** on any uncertainty. The word "blur" is banned everywhere (§18.1) — it is "cover". §18.5-P2 asks for a **pixel-level test that the public derivative never contains the vault original's bytes**; that is the central integrity invariant of this milestone and belongs in a gate or an e2e, not a comment.

2. **E2E vault + the first `SEALED-E2E` endpoint.** Random 256-bit CEK per file → XChaCha20 chunked (already built) → R2. **Tier A**: CEK sealed to reporter vault key + one off-platform custodian. **Tier B**: Shamir 2-of-3 (`packages/crypto/src/shamir.ts` exists) with a **mandatory offshore share in every quorum**. The platform holds **zero shares and exposes no unwrap endpoint** — that is what makes "we cannot produce plaintext" literally true. Never add an org-wrapped copy of a content key.

   **READ THIS BEFORE YOU START — a landmine I set deliberately in M2.** `gate-sealed-body` currently fails if *any* unseal-shaped binding exists anywhere once a `SEALED-E2E` endpoint is registered. `INTAKE_PRIVATE_KEY` **does** exist (consumer, for the metadata envelope). So registering M3's first E2E endpoint **will fail the gate**. That is intentional friction, not an accident: the fix is to refine the gate so the E2E check is scoped to the **data class of that endpoint**, with the registered `platform_key` entries for TO-PLATFORM endpoints explicitly acknowledged rather than globally forbidden. Do **not** fix it by deleting the check or renaming the binding — the whole point of the M2 change was to stop exactly that.

3. **Multipart resumable presign, finished.** `packages/outbox` has the 5 MiB engine (ETag-before-advance, re-mint on 403, idempotent complete). `workers/media` has aws4fetch presign. Wire the real end-to-end path and prove a resume across restart and network change.

4. **`CustodyChain` DO + custody ledger + §63 BSA export.** Already classified `SQLITE_OK` in `gate-memory-only`, so no gate edit — but it must live at `workers/api/src/do/CustodyChain.ts` and needs api wrangler tag **v4**. Honesty is load-bearing here: "preservation supporting lawful processes, **not admissibility**". No court-admissibility guarantee, ever.

5. **The corroboration-reach machinery** (§15, §18.1 puts it at M3). This is where `reachMachineryEnabled` becomes flippable: √-damped reputation into reach, `clusterCap`, `K_src`, **`CoordinationWindow` DO** (already in `gate-memory-only`'s `WHOLLY_MEMORY` list — memory-only, alarm-purged, **no persisted co-witness or social graph, ever**), cohort-pivot detection, diversity-of-corroboration-history weighting. `packages/worker-lib/src/reputation.ts` has the primitives; nothing is wired to reach yet.

6. **Archive tables + dedup.** `perceptual_hashes` (BK-tree / banded LSH, **NOT** Vectorize — it does cosine/euclidean/dot only), `archive_items`, `archive_provenance`, `archive_disputes`. Exact-byte dedup collapses storage; perceptual matching is **reversible presentation-clustering that never deletes an object**. The dedup/pHash index covers **public derivatives only** — vault-original fingerprints never enter plaintext D1. Keep `original_sha256` always; keep ONE pristine original per exact-byte-unique admitted item and never discard it.

7. **Source-media import**: fingerprint-and-reference on off-platform egress. Counsel-gated (#14 ToS).

**M3 admission rule is fail-closed** (§16): the permanent public archive admits ONLY media that is verified AND human-confirmed face/plate/PII-redacted (including contextual re-identification review) AND non-radioactive AND optimized. Anything else is sealed-vault-only or short-purged. **Durable ≠ immutable**: no Bucket Lock and no off-Cloudflare replication before a re-scanned probation window clears; a multi-party logged **purge-override supersedes every lock and replica** for illegal content or a lawful erasure order. The §7.3 preservation flip is counsel-gated — ship the reversible parts (dedup, transcode, model, display) and keep locks/replication/IPFS behind a flag.

## M4 — Brokered aid (outline; plan properly on arrival)

Read ARCH §5.3, §9.2, §9.3. Medical / mutual aid / assistance on **sealed-box one-shot** (`crypto_box_seal` — libsodium is fine here, it sits behind the vault, not on first paint; `packages/crypto/src/sodium.ts` is the lazy loader). `Broker`/`Mailbox` memory-only routing + R2 ciphertext, late reveal, anti-honeypot, **jittered alarm-tick delivery**. Medical and detention are **onion-only and must refuse over clearnet**. `skills_registry` is brokered, **never browsable**. First real use of `requestSeed` per-request identities (already in `hkdf-tree.ts` and `device-keys.ts`, unused so far). Prekey fetches are never persisted. `Broker`/`Mailbox` are already in `gate-memory-only`'s `WHOLLY_MEMORY` list.

## M5 — Realtime + accountability (outline; plan properly on arrival)

Read ARCH §6, §8. `LiveBoard` (sharded HLL, memory-only, already classified), zone-level never finer than geohash-6, delayed (base + jitter), **density-floored with suppress-until-safe-density**, coarse crowd **bands never counts**, short-TTL, **memory-only — never DO SQLite or D1**. `DeadlineTimer` (SQLite, content-free payloads). Accountability records + `ReviewGate` DO (console-hosted) + detainee tracker. **Every irreversible gate ships OFF behind an unsatisfiable quorum.** The facilities layer is precise but **physically segregated** so it can never be joined to protestor density.

## DECISIONS ALREADY TAKEN (do not re-open)

- **Compartment enum is closed, 8 entries, ordinals append-only** (they go on the wire): `document(0) directory(1) community(2) accountability(3) curation(4) medical(5) aid(6) legal(7)`. M4 activates `medical`/`aid`; M5 activates `accountability`. Widen `ACTIVE_COMPARTMENTS` in `packages/crypto/src/compartments.ts` when you do.
- **Cap-cert is self-issued and authorises nothing.** Sybil resistance is Turnstile + rate ladder + reputation, never the cert.
- **The intake key is operational, not ceremony, and explicitly NOT E2E.** The register body is `SEALED-TO-PLATFORM`. The evidence original is a different object with a different claim.
- **Backup words are erased by default** after the user re-types 3 of 12; one opt-in setting (default OFF) keeps them; it cannot be re-enabled once erased.
- **`reputation_scalars` lives at M2 with writes flag-gated** (zero rows until switch-on). ARCH §4.2 was corrected to match.
- **The §15 machine lives in `packages/worker-lib/src/verification/`**, not in a worker, because api and consumer both need it and workers cannot import each other. It is deliberately **not** in the worker-lib barrel (`cap-cert.ts` also exports `DEFAULT_POLICY`).
- **UI/route/flag vocabulary is "document"**, not "record" or "report" (PRD.md:830 — रिपोर्ट करना reads as filing an FIR).

## NON-NEGOTIABLE GUARDRAILS

The three red lines (no public target list; no unverified plainclothes identity claims; no live or persistent individual location). The reversible/irreversible line: AI and community emit ONLY `{label, rank, hide-pending, retain-pending, route-to-gate}` — `gate-action-vocabulary` now fails the build if an irreversible verb appears anywhere in the trust-engine source. Autonomous ceiling `Community-Corroborated` with capped sub-amplification; `Human-Verified` is Layer-B only and needs two distinct Access subjects. Structural invariants: no member directory or enumeration endpoint, no social/vouch graph, no identity↔pseudonym map, no subscriber roster, no real-name/phone/SIM/OTP identity or recovery. Sensitive data sealed client-side; intake rejects non-sealed bodies; the platform holds no key and no unwrap endpoint for E2E classes. Coarse geo only. Redaction irreversible, fail-closed to vault-only. Retention honestly qualified against PITR/Time-Travel. `safeLog` only, no query logging. Every data-holding feature behind a fail-closed flag; heightened-threat tightens only. Memory-only DOs never touch DO storage OR D1.

**Honesty is a correctness property, not a tone preference.** If a guarantee holds only "in bulk / absent a targeted code-injection order", phrase it that way. If something is not verified, the UI says so. No court-admissibility promise.

## BUILD GOTCHAS (hard-won — these will bite again)

**Process**
- Run the FULL `pnpm typecheck && pnpm build && pnpm gates && pnpm pack:verify && pnpm test` before every commit. A per-filter typecheck has missed a CI failure.
- **RUN THE APP.** The worst bugs this project has had were invisible to types and unit tests. `pnpm --filter @harborage/web exec playwright test` for anything web-facing; `wrangler deploy --dry-run` before pushing binding changes. Kill orphaned `wrangler dev` first (`pkill -f "wrangler dev"`) — local e2e flake is almost always that, and `share-pack`/`document` are the usual victims under parallel load. CI retries twice.
- **`gitleaks` scans every commit in the PR range, not the final tree.** A false positive you already fixed will still fail CI until you squash the branch history. Its `generic-api-key` rule fires on a comparison that merely LOOKS like an assignment of a long value to a key-ish identifier (a `keyish.field === SOME_CONST.member` expression will do it) — restructure the code rather than adding a suppression file, since a suppressions list is where a real finding eventually hides. Note this doc originally tripped the same rule by quoting the offending expression verbatim.
- **`zizmor` collects `**/.github/workflows/*.yml`**, including fixtures. Keep deliberately-broken workflow fixtures outside that exact path.
- **Branch before you build.** I once committed a whole slice to `main`; branch protection caught it, but recovering cost time.

**Gates**
- `gate-selftest` requires **every** `gate-*.mjs` to have `tools/gates/fixtures/<gate>/{pass,fail*}/`. Several `fail-<reason>/` trees are supported and you should use them — one shared fixture only proves whichever check fires first. **This harness has caught three real bugs, two of them in gates written minutes earlier. Trust it over your reading of your own regex.**
- `gate-memory-only` keys off the DO file's **basename**, fails unclassified classes, and scans **inside comments**. `CoordinationWindow`, `Broker`, `Mailbox`, `LiveBoard` are already in `WHOLLY_MEMORY`; `CustodyChain`, `DeadlineTimer`, `ReviewGate`, `CurationCoordinator` already in `SQLITE_OK`. `VerificationState` is `FIELD_FORBIDDEN` and its regex bans `signal|location|lat|lng|latitude|longitude|timing|arrival|pubkey|public_key` **in comments too** — that is why its vocabulary says "observations" and "day bucket".
- `gate-schema` and `gate-memory-only` grep **inside SQL comments**. `gate-d1-index` fails any Worker query filtering an unindexed column and **does not parse table-level `UNIQUE`** — use a standalone `CREATE UNIQUE INDEX`.
- `gate-ai-tells` scans `content/` + `apps/*/messages/` in EN and HI. No em-dash, no `!` anywhere (JSON included), no banned words; Hindi uses `।`.
- `gate-sig-context` bans raw curve `.sign()` outside `packages/crypto/src/`.
- `gate-action-vocabulary` scans `packages/worker-lib/src/verification/` with **substring** matching (not `\b`, because `\bpublish\b` misses `publishItem()`).
- `gate-sealed-body` needs ≥2 assertions + a 4xx + a live route per registered endpoint, and now requires every unseal-shaped binding to be registered with a justification. **See the M3 §2 landmine note above.**

**Crypto**
- Importing the `@harborage/crypto` **barrel** into a Workers-typed package drags `seal.ts` → `globalThis.crypto` into tsc and fails. Use subpath exports. Same for `device-keys.ts` — anything needing both sides goes in `apps/web` (the only workspace with DOM types that depends on both packages).
- **`@noble/curves` P-256 verify needs BOTH `prehash: false` AND `lowS: false`** to accept a WebCrypto ECDSA signature. noble's `prehash` defaults to `true` (it hashes for you); WebCrypto does not normalise S. At the defaults it fails ~50% of the time, only on the phones that need the fallback tier. **Any test touching ECDSA must loop** — a single assertion passes by coin flip. `packages/crypto/src/signature.ts` is the single place that knows this; keep it that way.
- Every signature takes a mandatory `SigContext`. Add new contexts to `SIG_CONTEXT` in `compartments.ts` (unique, `harborage/sig/` prefix, `/vN` suffix, `as const`).

**Web**
- CSP lives in `apps/web/svelte.config.js`, NOT `_headers` — Kit appends inline-bootstrap hashes to `script-src`, and a second policy without them blocks hydration on every prerendered page. `connect-src` must keep allowing `https://*.r2.cloudflarestorage.com`. Adding a Trusted Types policy name requires listing it in `trusted-types` or Kit refuses to build.
- Trusted Types is enforced on all pages. `new Worker(new URL(...))` needs the same-origin default TT policy (see `pipeline-client.ts`), and Vite requires the literal form — moving the URL into a helper breaks bundling and the worker 404s.
- Svelte 5 `$state` proxies are NOT structured-cloneable — snapshot before `postMessage`/`IndexedDB.put`. Naming a variable `state` **shadows the `$state` rune** in svelte-check.
- `apps/web/vitest.config.ts` includes only `test/**`, with no `$lib` alias and no DOM — anything unit-tested there must import nothing (hence the `*-core.ts` split pattern). Playwright's `allInnerTexts()` does **not** auto-wait; assert a count first.
- Every route is prerendered: IndexedDB must be lazily opened, never at module scope.

**Cloudflare / CI**
- New DO class → new wrangler migration tag (**never edit a deployed tag**, api is at v3) + re-export from the worker entry + classify in `gate-memory-only`.
- `deploy.yml` order is console → web → api → media → **consumer last**. A cross-script DO binding must deploy after the class owner.
- **`HB_DEPLOY_TOKEN` already has Queues scope** (the consumer deployed fine). **Workers AI is still untested** — binding it may fail with Cloudflare error 10000. Do that in its own small PR and tell me one PR ahead.
- Deploys are `plan → apply → deploy`, all three gated on `production`. **All three must stay gated**: every secret is environment-scoped and there are zero repo-level secrets, so an ungated job reads them as empty and tofu fails "No valid credential sources found". Approve gate 1 without ceremony (read-only plan); **read the plan before approving gate 2**. `tools/plan-guard/check-plan.mjs` fails on any destroy or replace; `HB_ALLOW_DESTROY` is the escape hatch and needs a RUNBOOK line.
- The shell is **zsh**: unquoted `$VAR` does NOT word-split.
- **NO SEED DATA.** Migrations have zero INSERTs, production D1 stays at zero rows, demo data only via Playwright route interception.

## WORKING STYLE

Verify every Cloudflare limit / model / API shape and every library version against **live** sources (Cloudflare docs MCP, npm) — the training cutoff is stale and in-repo docs drift. When a doc and a live source disagree, the live source wins and you update the doc in the same commit.

Small, signed, type-prefixed commits, **no attribution trailer**. Branch off main → PR → CI green (`ci`, `e2e`, `zizmor`, `gitleaks`, `tofu-validate`) → rebase-merge for linear history. PR bodies explain **why**, including what you rejected and why. If you find a bug in existing code, fix it and say so.

**Prefer adding a CI gate over adding a comment. Negative-test every new gate** — a gate that cannot fail is worse than no gate, and this repo has now shipped three of those (all caught by `gate-selftest`, two of them within minutes of being written).

After each merge, approve the production deploy, cancel superseded waiting runs, and tell me the run id.

If something is unsafe, creates a compellable record, crosses a red line, or needs counsel — stop and ask, and choose the safer, less-data default. Shipping the unsafe version is worse than shipping late.

**Start with M3 slice 1 (redaction), and read the M3 §2 gate landmine before you get to the vault.**
