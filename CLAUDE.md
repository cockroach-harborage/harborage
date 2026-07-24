# CLAUDE.md — Harborage

Guidance and **binding standards** for Claude Code and every contributor working in this repository. Read this first.

## What this project is

**Harborage** is open-source, Cloudflare-native, GitHub-Actions-managed web infrastructure to support **peaceful, lawful, democratic protest and human-rights documentation in India** during an ongoing protest — coordination, incident and evidence documentation, a durable open evidence archive, medical and mutual aid, a public verified resource directory, legal and accountability tracking, live ground conditions, a community feed, official signed notices, and autonomous-first (AI + community) fact-checking. It is **neutral civic infrastructure**, not the apparatus of any party or movement. It serves the public, protestors, people seeking help, volunteers, and provider organizations — usable from day 1.

- **Product spec (what to build):** [PRD.md](./PRD.md). Read its "Session 2.5 updates" note first.
- **System design (how):** [ARCHITECTURE.md](./ARCHITECTURE.md). §14 = version pins; §15 = autonomous-first trust; §16 = evidence archive; §17 = IaC.
- **Manual steps only:** [RUNBOOK.md](./RUNBOOK.md).

These documents are the source of truth. If you change the design, update the doc in the same commit.

## Always check for the latest versions (important)

Your training data has a cutoff, and Cloudflare and our libraries change often. Do **not** rely on memory for versions, limits, pricing, model IDs, or API shapes.
- **Cloudflare:** verify any feature/limit/price against the **live Cloudflare docs** (the Cloudflare MCP `search_cloudflare_documentation` + the changelog) before using it.
- **Libraries/tools:** check the **latest release and changelog** before adding or upgrading. Prefer the pins in ARCHITECTURE §14, but re-verify — they were current on 2026-07-22 and will drift.
- When a doc and a live source disagree, the **live source wins** — then update the doc.

## Commit conventions

- **Commit regularly** — small, logical, descriptive commits as work progresses, not one giant commit at the end.
- **Do NOT add any attribution trailer** — no `Co-Authored-By`, no "Generated with", no tool/agent credit. Plain messages only.
- Imperative, type-prefixed subjects: `feat(web):`, `fix(infra):`, `docs:`. The repo **builds and typechecks at every commit**.
- **Sign commits** (branch protection on `main` requires it, once the remote is set up).
- **Never commit secrets** — no keys, tokens, `.dev.vars`, `.env*`, `backend.hcl`, `terraform.tfvars`. Signing keys are generated offline and never enter the repo or CI.

## Infrastructure & operations discipline

- **Anything that can be done in code MUST be code** (OpenTofu / Wrangler / CI). The Cloudflare dashboard and MCP servers are for **reads and diagnostics only**. A manual write is allowed **only** when IaC genuinely cannot do it (state-bucket bootstrap, token minting, one-time product activations, offline key ceremony) and it is **recorded in [RUNBOOK.md](./RUNBOOK.md) in the same PR**. Anything mutated outside the repo is unrecorded drift. Keep the runbook as small as possible.
- **One writer per resource.** OpenTofu owns account/zone resources; Wrangler owns the Worker and its bindings. Never two writers on one hostname. IDs flow Terraform→Wrangler via CI `REPLACE_*` injection; never hardcode them.
- **`prevent_destroy`** on anything whose loss is catastrophic (Email records, the Access application, signing-key config). A plan that shows a destroy on one of those is a bug: stop, investigate, never apply.
- **Deploys are CI-only** (no laptop deploys), through the **deprivileged two-token pipeline** (the Terraform token never enters the job that runs third-party code). **No auth-bypass code path ever ships.**
- **Encode invariants as CI gates, not review etiquette** (§17.5): the no-AI-tells/plain-language gate, strict-CSP + Trusted-Types gate, `safeLog` gate, memory-only-invariant test, sealed-body test. If a rule matters, make the build fail when it's broken.
- **Supply chain:** `pnpm` only + `--frozen-lockfile`; GitHub Actions pinned to full commit SHAs; Dependabot/Renovate never auto-merged; before adding a dependency, check whether ~30 lines of code does the job.

## Content & UX standards

- Write for the hardest reader first: scared, low-literacy, non-English, cheap
  phone, bad network. If it works for them, it works for everyone.
- Plain simple language. Max 12 words per sentence in safety and action copy.
  One idea per line. Verb first. Present tense. Common words: "send" not
  "submit", "use" not "utilise", "posts" not "feed".
- NO AI TELLS. Banned: em-dash chains; exclamation marks in safety copy;
  rhetorical-question openers ("Need help?"); filler ("simply", "just",
  "easily", "let's dive in", "in this section"); marketing words (seamless,
  robust, leverage, empower, unlock, streamline, effortless, curated, journey);
  hedging ("please note", "kindly", "in order to"); drama ("your voice
  matters"); fake warmth; corporate apology; emoji as decoration. Read it
  aloud: if it sounds like a brochure or a bot, rewrite it.
- Non-English and non-tech first. No jargon. Icon plus text label, never icon
  alone. All strings in message files with ICU; no hardcoded text, no
  concatenation.
- Don't overwhelm. One primary action per screen. ~5–6 choices at a time.
  Everything reachable in ≤2–3 taps. Advanced things revealed on ask.
  No horizontal scroll on any primary path.
- Honest checking labels only. Four plain labels: "Verified by our team",
  "Confirmed by people nearby", "Not checked yet", "Reported as a problem".
  Never say "verified" unless a person verified it. Never show scores or AI
  machinery to the public. Word first, colour is decoration only.
- Accessibility is default, not a later pass: 48px targets, 17px base text,
  200% zoom, colour never the only signal, visible focus, reduced-motion
  honored, screen-reader labels.
- Calm and discreet, never dramatic. Ordinary-looking app. No siren red, no
  pulsing, no fake calculator. Quick-exit is a plain "Close". Notifications
  never carry sensitive content.
- Be honest about limits. Don't promise protection the platform can't keep
  (device seizure, video face-blur, offline text-to-speech, recent-apps
  hiding). Say what stays on the phone and what doesn't.

## Safety, Security & Confidentiality Standards

This platform holds data that can get vulnerable people arrested, surveilled, tortured, or killed. The adversary is a resourceful, hostile **state-level actor** whose dominant capability is **metadata and traffic correlation** (telco/ISP IP+SNI logging, IMSI catchers, internet shutdowns, DNS/SNI blocking, CDN/hosting legal compulsion in both the US and India, device seizure + coercive unlock, infiltration/agents-provocateurs, disinfo/astroturf, doxxers) — not breaking content crypto.

These standards are **binding on every contributor and every AI session**. They are written to be self-checkable: you should be able to read a diff and decide whether it complies. When a change touches anything here it requires the maintainers, and — where flagged — **legal counsel** sign-off before it ships. When in doubt, treat the change as sensitive. Do not design *around* these rules; if one blocks the feature, the rule wins. If you believe a rule is wrong, raise it — do not quietly route past it.

These standards operationalize the seven non-negotiable principles (PRD §1), including **(4) truth & anti-manipulation** — verification-labeling, no vanity amplification, anti-astroturf — and **(5) inclusion & resilience** — low-end/offline/i18n as safety, not polish. Source of truth for the detail behind each rule: [PRD.md](./PRD.md) §4–§12 and [ARCHITECTURE.md](./ARCHITECTURE.md) §4–§10, §14 (§14 is authoritative on version pins).

### 1. The three red lines (enforce, never design around)

Not tunable, not "later." Code that crosses them does not merge.

1. **No public target list.** Accountability names **official-capacity misconduct only** — badge/rank/unit/station, and name where officially established — tied to a specific documented incident, and **only** after passing the multi-person Review-gate (default WITHHELD; ≥2-of-≥3 reviewer role-key signatures over the canonical record hash; verified + corroborated; documentary anchor; no-call-to-action classifier pass; right-of-reply). **Never** publish home/family/private contacts/private social accounts/personal-life data of *anyone* (official or not). **Never** "wanted"/bounty/"confront/find/locate/retaliate" framing. Most-identifying dossiers and detainee identity stay **off-platform** (lawyer-side); the platform holds only opaque refs/hashes/case numbers.
2. **No unverified identity claims about plainclothes / "posing-as-police" individuals.** Stricter **default-DENY** path: the claimed identity is **not stored pending review** — only the claim + an evidence hash. Withheld unless a higher corroborated, human-reviewed bar is met. Misidentification gets innocent people hurt.
3. **No live individual location, no who-was-where-when log.** No "I am here"/self-location GPS primitive, no live broadcast of an individual's precise position, and **no persistent queryable presence/location table anywhere**. The live board is zone-level (never finer than geohash-6), delayed (base + jitter), density-floored (**suppress-until-safe-density**), coarse crowd **bands** (never counts), short-TTL, and **memory-only** — protestor signals must never touch DO SQLite or D1 (PITR is compellable and cannot be disabled). The facilities layer (toilets/water/charging/aid) is precise but **physically segregated** so it can never be joined to protestor density.

### 2. Structural invariants (these must not exist)

Enforce absence at the schema/architecture layer, not by policy. A CI check and CODEOWNERS guard the load-bearing ones.

- **No real-name / phone / email / SIM identity.** Accounts are on-device keypairs derived from a BIP39 mnemonic. No PII, no session table, no account row.
- **No phone/SMS/email auth or recovery.** No SMS OTP, no email/SMS reset. "Lose the mnemonic = lose the account" — the absence of a recovery backdoor *is* the security property. State it verbatim in-product.
- **No member directory / list-all-users.** No enumeration endpoint anywhere. `reputation_scalars` is a PII-free per-compartment pubkey list with no enumeration API; any reputation-gated feature is switch-gated on blind-token/anonymous-credential reputation so the server holds no list.
- **No social / follow / vouch graph.** Follow areas and topics, never people. Vouch/probation applies a revocable scalar delta and **discards the causing edge**. No edge/vertex table.
- **No identity↔pseudonym map.** Verified-professional badges ride verify-then-forget / blind tokens; the mapping never lands on-platform.
- **Privileged surfaces are off the public app.** Moderation, official-notice publishing, the accountability Review-gate, and kill-switch admin live on a separate hostname behind **Cloudflare Access + phishing-resistant passkey/hardware MFA**.
- **Per-feature kill switches + a one-flip heightened-threat mode** exist for every data-holding feature and can disable it instantly during a live crackdown.

### 3. Confidentiality standards

- **Client-side E2E on every sensitive surface.** Brokered aid / medical / assistance channels, the evidence vault, and the case-doc vault are sealed **client-side before submit**. The intake Worker **structurally rejects any sensitive-endpoint body that is not a sealed envelope**. All security-critical logic (key custody, HKDF derivation, sealing, redaction, geo-coarsening) runs client-side so a swapped or compelled Worker sees only ciphertext, opaque tokens, and pre-fuzzed data.
- **"We cannot produce plaintext," made literally true.** The platform holds **zero key shares and exposes no unwrap endpoint** for E2E data. Evidence CEKs are reporter-held + off-platform custodian (Tier A) or Shamir threshold with a **mandatory offshore share in every quorum** and air-gapped reconstruction (Tier B). Never add an org-wrapped copy of a content/evidence key, and never upload one.
- **Unlinkable compartmentalization.** Per-domain (and per-request for medical/aid) identities via the HKDF tree; no server-side join key; one compartment per session, enforced — a two-compartment request is rejected. Be honest: this is unlinkability **at the key/transport layer only**; content/stylometry/shared-IP/timing can re-link. Warn users against reusing writing style or verbatim detail across compartments.
- **Metadata minimization + no IP logging (honestly scoped).** `safeLog()` is the only logging path; lint bans raw `console.*`; never log IP, geo, identifiers, tokens, bodies, or full URLs. Scrub `CF-Connecting-IP` at ingress. But state plainly: this governs **our** retention only — Cloudflare's platform telemetry, the ISP's SNI, and billing capture IP/SNI/timing independently and are compellable. Never claim "no IP logging" unqualified.
- **Tor/.onion for life-safety flows.** Medical broker and detainee/incommunicado handshakes are **onion-only, refuse over clearnet** (two IPs on one low-volume DO within the jitter window is a strong pairing sealed-sender can't hide). On PWA v1, onion is a minority/opt-in path — **do not call it "primary"**; the operated onion origin + APK-bundled transport is the milestone where source-IP protection becomes real.
- **Timing decorrelation.** Encrypted outbox dispatch is decorrelated from authoring (foreground-flush + jitter); broker DOs mediate on a fixed jittered alarm tick. Honest limit: decorrelation is meaningful, not information-theoretic — no constant-rate cover traffic on 2G/battery.
- **Content-free notifications + follow model.** Default to content-free poll-on-open + foreground long-poll/WebSocket. **No third-party push (FCM/APNs) for anything sensitive** — the subscription set is a compellable device-linked roster. Web Push is dropped from v1; timely background alerts require the APK — say so on medical/detention surfaces. "Follow" is client-held (IndexedDB) over public per-object update feeds; **never build a server-side subscriber↔identity roster.**

### 4. Privacy-by-default, data minimization & retention

- **Safe values are the defaults, always.** Location off, metadata-scrub on, redaction on, ephemeral identity, coarse/jittered/delayed geo. Any safety-consequential action confirms toward the safe / no-data choice.
- **Redaction is irreversible.** Solid-fill only (never reversible blur/mosaic), with mandatory human before/after confirm, **failing closed to vault-only** on uncertainty. The public redacted derivative is the only server-readable output.
- **Minimize, then expire.** Collect the least; retain the shortest; auto-expire via Cron sweeps + DO alarms + short token/URL TTLs. **Retention sweeps are NOT a compulsion defense** — D1 Time Travel (~30d) and DO SQLite PITR (30d, cannot be disabled) mean a compelled restore defeats "we deleted it." Only three postures survive compulsion: **E2E ciphertext, off-platform custody, or DO-memory-only state.** Qualify every "ephemeral = safe" claim outside those three.
- **Discovery/search over PUBLIC-PLAINTEXT content only.** Search serves directives/KYR, public incident views, accountability records, and facilities from Cron-materialized D1 rollup/index tables — **no query logging, no user/identity search, ever.**
- **Low-trust channels carry only public, signed, non-personal broadcast content, outbound.** SMS/USSD/IVR/no-JS **never accept sensitive input** — there is no code path from them to any write/intake endpoint.

### 5. Security standards

- **Abuse / DDoS / DoS defense.** Turnstile (tuned to admit Tor/VPN) + layered rate limits + reputation-gating in front of any intake or AI. **Volumetric L7 DDoS relies on Cloudflare's managed/unmetered rulesets;** WAF custom-characteristic rate-limiting is unavailable on the funded plan, so the **RateLimit DO is the deliberate app-layer substitute.** Never gate *reading* public safety info. No raw-IP logging on protestor endpoints. AI moderation runs behind spend caps with a kill-switch that degrades to human-only.
- **Phishing-resistant MFA on all privileged surfaces.** **WebAuthn only — hardware security key or platform biometric (Touch ID / Face ID / Windows Hello); no SMS OTP anywhere.** Enforced via Access Independent MFA with `allowed_authenticators = ["security_key","biometrics"]` (both WebAuthn, both phishing-resistant), AAGUID-restricted to ceremony-issued keys, and IdP-AMR-matching **off** so the guarantee is not delegated to the IdP. **Honest limit (verified 2026-07-25):** Access Independent MFA **cannot** enforce security-key-*only* — if a single method were the sole allowed one, users would see no available method, and TOTP cannot be excluded at the org level; the WebAuthn-only pair above is the strongest achievable posture, and these are **org-level** settings (a RUNBOOK manual step, hardware-AAGUID-dependent), not per-app tofu.
- **Anti-replay on per-request proof-of-possession.** PoP binds a server-issued challenge or short-window timestamp + nonce; the api Worker rejects stale/seen nonces (bounded in the RateLimit/CIB memory DO). A captured PoP must not be replayable.
- **Client-side web hardening is a first-class integrity control.** Strict nonce-based **CSP (no inline/eval), Trusted Types**, and a security response-header baseline, enforced in the web Worker and CI-linted. For a browser-crypto PWA an XSS equals the code-injection threat — Svelte auto-escaping is not sufficient.
- **Supply-chain + CI hardening.** Every GitHub Action pinned to a full 40-char SHA (zizmor/ratchet enforced). `harden-runner` egress-block. Default `GITHUB_TOKEN permissions: {}`. Secret scanning + push protection. Branch protection on main (linear history, required checks, **signed commits**, no force-push, admins included). **Build / attest / deploy are separated**: build holds no Cloudflare creds; only deploy holds the scoped, quarterly-rotated token (no CF OIDC exists — the token is *contained, not eliminated*; say so, never claim "no long-lived secrets").
- **No secrets in the repo, ever.** No keys/tokens/`.dev.vars`/`.env`. Signing, release, canary, and content/evidence keys are generated offline in an m-of-n hardware-token ceremony and **never enter the repo, CI, or Cloudflare**.
- **Signed, verifiable releases.** Sigstore keyless SLSA provenance (**Build L2** — do not claim L3); **minisign detached signatures** over release artifacts and offline knowledge packs, signed by the offline project key, verified in-app against the pinned pubkey. The service worker refuses assets not matching the signed `{path:sha256}` manifest + SRI.
- **≥2 reviewers + CODEOWNERS on every sensitive path.** `workers/**` (esp. auth/crypto/location/evidence), `migrations/**`, `.github/workflows/**`, `infra/**wrangler*`, all signing/canary code, the frozen crypto module, and the DO memory-only invariant classes. A single compromised or coerced contributor/reviewer must not weaken a user-protecting default. (Publication is quorum-required; removal is single-reviewer — an infiltrated reviewer's max unilateral harm is suppression, an accepted fail-safe direction.)
- **Kill switches + heightened-threat mode.** FlagState DO is source of truth; propagation is bounded by TTL, per colo (no cross-colo purge — state flip latency honestly). Fail posture is **split**: privacy-sensitive writes/location fail **closed**; safety-critical hazard/SAFE_EXIT reads fail to **last-cached-with-STALE-badge**, never dark. Irreversible flips + accountability-publication/detainee-intake toggles require **2-person authorization**.
- **Coordinated disclosure + researcher safe harbor.** `/.well-known/security.txt`; encrypted **identity-optional** intake (PGP/age or onion drop, not email). **De-anonymization / redaction-bypass / code-injection bugs are P0** with an embargoed window; a sensitive field reaching logs is Sev-1. Handle privately; no public 0-day window on a weaponizable flaw. Stated safe-harbor commitment.
- **Incident-response / continuity runbook.** (a) Signing-key compromise → revocation epoch bump + peer-QR revocation propagation + re-key ceremony. (b) Breach → user notification via a **signed Official Notice** + canary shift (there is no directory/push/email channel). (c) Forced takedown → non-CF mirror + fork continuity.
- **Warrant canary.** Human-produced, offline-minisign-signed, published to `/.well-known/canary.txt` with a hard expiry. **Signing stays manual/offline by design** — automating it would let a compelled Cloudflare keep it alive. Missing/expired signature *is* the signal.

### 6. App-code integrity & honest-limits contract

- **App-code integrity is the root of trust.** Client-side scrub/redact/E2E/signing/panic are worthless if the edge serves a poisoned client. A compelled edge can serve **poisoned JS to one targeted user** undetectably from inside the page. So **every client-side-crypto guarantee is conditional** — "platform cannot read," "irreversible redaction," "no precise GPS leaves the device" hold **in bulk / absent a targeted code-injection order**, and must be phrased that way on high-risk surfaces. SW-pinning + reproducible-build + edge-watcher give **broad-tamper detection, not targeted-hit prevention**. The **OS-signature-verified Capacitor APK is the only real fix** — the highest-risk flows (evidence-vault capture, detainee/incommunicado, accountability naming by reviewers) are APK-gated.
- **Ship an honest-limits contract** (first-run + always-available, multilingual en/hi, derived from ARCHITECTURE §9.7). State plainly what the tool **cannot** protect against: app use is observable to ISP + Cloudflare; targeted per-request client poisoning on the web is undetectable in-page; browser key custody / panic-wipe / decoy accounts are best-effort until the APK; Cloudflare, any onion VPS operator, any SMS partner, and any human key-holder are legally compellable; traffic-analysis resistance is partial; compartment unlinkability is key/transport-layer only. **False confidence gets people arrested — never oversell.** No court-admissibility guarantee; capture is preservation, not admissibility.

### 7. What counts as a "sensitive-path change"

Treat a change as sensitive (→ maintainers + the checklist below; counsel where flagged) if it touches **any** of:

- Cryptography, key derivation/custody, sealing, or the frozen crypto module.
- Identity, accounts, recovery, reputation, compartmentalization, or verification badges.
- Location, geo-coarsening, the live board, crowd bands, or density floors.
- Evidence capture, redaction, the vault, custody ledger, or source-media import.
- Accountability naming, the Review-gate, detainee/legal tracking, or the incitement/doxxing tripwire.
- Brokered aid / medical / assistance channels, JIT safety briefings, or any E2E envelope.
- Notifications, follow/subscription state, the outbox, timing decorrelation, or Tor/onion routing.
- Discovery/search, retention/expiry, logging/`safeLog`, or anything that could persist metadata.
- Auth on privileged surfaces, kill switches, heightened-threat mode, or the DO memory-only invariant classes.
- CI/CD, workflows, action pins, secrets handling, signing, the warrant canary, CSP/headers, or CODEOWNERS.
- Any new data field, table, DO storage write, KV key, or third-party dependency.

### 8. Pre-merge safety / privacy checklist

Self-review every change. On a sensitive-path change, state your answers in the PR.

- [ ] **No red line crossed** — no path to a target list, an unverified plainclothes ID, or live/persistent individual location.
- [ ] **No forbidden structure created** — no directory/enumeration, no social/vouch graph, no identity↔pseudonym map, no subscriber roster, no real-name/phone/SIM/OTP identity or recovery.
- [ ] **New data is justified and minimized** — least collected, correct custody class (PUBLIC / E2E / OFF-PLATFORM), and **not** written to a memory-only invariant store.
- [ ] **Sensitive data is sealed client-side** and the intake endpoint rejects non-sealed bodies; the platform holds no key and no unwrap endpoint.
- [ ] **No new metadata leak** — no IP/geo/token/body in logs; no new compellable roster; timing/notification/follow path doesn't leak membership or presence; search indexes public-plaintext only, no query logging.
- [ ] **Defaults are safe** and safety-consequential actions confirm toward the no-data choice; JIT briefing gate present on any new aid request/offer path.
- [ ] **Retention/expiry set**, and any "ephemeral" claim is qualified against PITR/Time-Travel unless E2E / off-platform / memory-only.
- [ ] **Kill switch + heightened-threat behavior** defined; fail posture correct (writes/location fail closed, safety reads fail to stale).
- [ ] **No secret in the diff**; actions SHA-pinned; **commit signed**; CSP/Trusted Types intact; ≥2 reviewers + CODEOWNERS satisfied on sensitive paths.
- [ ] **Claims are honest** — guarantees phrased as "in bulk / absent targeted injection," no forensic-grade or admissibility overpromise; honest-limits copy updated if the limit changed.
- [ ] **Counsel gate** identified where required (accountability naming, detainee data, legal entity, verifier scheme, content line, live-view params, source-media ToS) and not switched on without it.
- [ ] **Docs updated in the same commit** if the design changed.

### 9. If in doubt, stop and ask

If you are unsure whether a change is safe — how it interacts with the threat model, whether it creates a compellable record, whether it crosses a red line, or whether it needs counsel — **stop and ask the maintainers, and where legal exposure is possible, counsel.** Shipping the unsafe version is worse than shipping late. When you cannot get an answer, choose the more conservative, less-data, safer-default path and flag it for review.

## Trust & Safety — autonomous-first, human-hardened (LOAD-BEARING)

- **The reversible/irreversible line is absolute.** AI + community may act
  AUTONOMOUSLY only on REVERSIBLE, NON-CATASTROPHIC actions: assign/relabel
  verification-state, rank/amplify/down-rank reach, quarantine-PENDING
  (HIDE, never delete), retain-pending, queue-for-human. They may NEVER
  autonomously perform an IRREVERSIBLE HIGH-HARM action: publish an
  individual's identity (accountability naming), unredact evidence, reveal
  precise location, permanently delete evidence. Those stay m-of-n
  human-gated and ship KILL-SWITCHED OFF behind an unsatisfiable quorum.
  The pipeline's action vocabulary is a fixed enum {label, rank,
  hide-pending, retain-pending, route-to-gate} — there must be NO code path
  from a model/community output to publish/delete/unredact/name.

- **Autonomous ceiling stays LOW and honestly labeled.** The highest state
  the autonomous layer can reach is `Community-Corroborated`, with CAPPED
  (sub-amplification) reach and the label "AI-checked & community-
  corroborated, NOT yet human-verified." `Human-Verified` and full reach
  are Layer-B (human) only. Never introduce an autonomous path to "Verified"
  language or top-tier reach.

- **Autonomous verification is STATE-DEFEATABLE — never overclaim.** A
  resourced adversary can defeat the source-diversity test. Credibility
  rests on honest labeling + a low ceiling + reversibility, NOT on the
  wall being unclimbable. Never write copy or a badge that presents an
  autonomous verdict as authoritative or reliable-for-action.

- **Manipulation-resistance is load-bearing.** Reach is a function of
  verification-state + independent corroboration + √-damped reputation —
  NEVER of raw engagement/votes. Votes/flags are inputs to the state
  machine, never outputs to the ranker. Preserve: r_gate (fresh accounts
  near-powerless), √-damping, clusterCap + K_src (Sybil/astroturf capped),
  behavior-only EPHEMERAL CIB with NO persisted social/co-witness graph,
  flags-never-auto-remove (coordinated flags → Disputed/hold, an attack
  signal, not consensus), cross-compartment provenance anchor + min-dwell
  for promotion, cohort-pivot detection, diversity-of-corroboration-history
  weighting.

- **Directive/operational content is a never-autonomously-amplified class.**
  Real-time directives/logistics/calls-to-action get a hard "do not act
  without confirming" interstitial and are never amplified above baseline,
  regardless of corroboration.

- **Individually-resolvable identifiers are NOT institutional.** Autonomous
  accountability aggregates only to station/unit/rank-band/shift. Badge
  number, name, plate, "the officer with X" → human-gated Naming Review-gate.

- **Fail-safe defaults, always:** default Unverified; Unverified never
  amplified; disagreement/low-confidence → Disputed/hold (never destructive);
  quarantine hides + retains (never deletes); synthesized (CIB/low-
  independence) disagreement carries a contested LABEL but NO reach penalty;
  uncertain-about-independence → count as dependent duplicate. Nothing good
  is permanently lost while humans are absent (retain-pending + auto-re-review
  + queue-for-human). The sole autonomous purge is narrow private-attack-PII
  radioactive payload WITH a recoverable vault original (else hide-not-purge),
  audit-row logged, vault original never touched.

- **Structural invariants (never violate):** no member directory, no
  social/follow/vouch graph (derived scalar reputation only, blind-token-
  carried), no real-name/phone, privacy-by-default, per-feature kill switches
  + heightened-threat mode (tightens only, never loosens).

## Evidence Archive standards

- **Admission is fail-closed.** The permanent public archive admits ONLY media that is verified AND human-confirmed face/plate/PII-redacted (including contextual re-identification review) AND non-radioactive AND optimized. Anything else is sealed-vault-only or short-purged. Unverified content is never public, never amplified.
- **Durable ≠ immutable.** No Bucket Lock and no off-Cloudflare replication before a re-scanned probation window clears. Never use indefinite locks. A multi-party, logged **purge-override supersedes every lock and replica** for illegal content or a lawful erasure order — this invariant ranks above deletion-resistance.
- **Minimize storage without sacrificing integrity.** Keep `original_sha256` always; keep ONE pristine original per exact-byte-unique admitted item and never discard it; optimize only derivatives. Exact-byte dedup collapses storage; perceptual matching is reversible presentation-clustering that never deletes an object. The dedup/pHash index covers public derivatives only — vault-original fingerprints never enter plaintext D1.
- **Contributor pseudonymity is structural:** no contributor→item edges, no identity map. Strip per-contributor key material, raw sensor bundles, and per-item timestamps from anything that leaves Cloudflare; external checkpoints publish coarse, jittered Merkle roots only.
- **Correction is append-only supersede, never erase.** Honesty always: "preservation supporting lawful processes, not admissibility." The §7.3 preservation flip is **counsel-gated** — ship reversible parts (dedup, transcode, model, display) first; keep locks/replication/IPFS behind a flag until counsel signs off.

## Resource Directory standards

- **Directory = organizations only, split by entity type.** The public `resource_entries` directory lists only organizations / already-public resources that consent to be found (`entity_type ∈ {ORG, PUBLIC_INFRA, INITIATIVE}`). **Never** create a public list of a named individual helper or of a person seeking help — those stay pseudonymous and brokered 1:1 (PRD §4.7–4.9). This is **schema-enforced (DIR-1)**: no column can hold a natural-person identity, home address, a seeker's need, or a who-verified-what edge.
- **No money brokering (DIR-2).** Financial/relief entries are pointers to a registered initiative's own channel only. Never add an amount, payment, or donation-routing field anywhere.
- **Every entry carries an honest `verification_state` + `trust_score`.** Reach is earned by verification, never engagement. Safety-critical categories (safe space, medical, legal aid, temporary accommodation) require human review before publish. `Signed`/`Verified`/core-infra entries are **never** community-auto-hidden — a report raises a human-review flag while the entry stays visible; staleness degrades to a "verify locally" badge, never removes.
- **Consent + visibility tier + remove.** Consent-first intake with a plain-language gate; every card has one-tap report-as-unsafe and provider remove-if-compromised (fail toward hidden). No bulk provider export, no query logging, never identity search. Directory reads degrade safe (last-cached + STALE badge), never dark. Heightened-threat mode demotes precise addresses and freezes intake.

## Build sequence

Follow ARCHITECTURE §12 (M0–M5), as updated by the Session-2.5 note there. Day-1 core (M0/M1) includes: the cached app shell + five-tab IA + Get help / Give help routers + offline crisis cards + zero-account browse + EN/HI plain-language content system + the autonomous AI+community trust engine + the seed resource directory. Human review is a **hardening** milestone; only the irreversible m-of-n gates (individual naming, unredaction, precise-location reveal, permanent deletion) stay human-gated and ship off. Data-holding features stay behind kill switches + readiness gates (legal entity, offline key ceremony, off-platform custodians) until those exist.

**If in doubt, stop and ask** (see charter §9): when you are unsure whether a change is safe, creates a compellable record, or needs counsel, ask the maintainers and choose the safer, less-data default. Shipping the unsafe version is worse than shipping late.
