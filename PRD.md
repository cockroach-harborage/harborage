# Harborage — Peaceful Protest Support Platform
## Features & Product Requirements Document (Session 1 deliverable)

---

## Context

**Why this document exists.** The goal is to build open-source, Cloudflare-native, GitHub-Actions-managed web infrastructure to help people engaged in **peaceful, lawful, democratic protest and human-rights documentation in India**: to coordinate, document abuses, get and give medical/legal/material help, hold official misconduct accountable, and stay informed under conditions of surveillance, internet shutdowns, and disinformation.

**What prompted it.** The user (part of / aligned with an organically-formed protest movement) asked for a single, comprehensive, community-led platform. This session's *only* job is to **finalize the feature set**. Two later sessions follow: (2) system architecture, (3) build.

**Intended outcome of this session.** A team-ready features/PRD document that everyone agrees on before any architecture or code. Architecture (hosting, key management, transport, mesh/SMS, E2E envelopes, data models) is **deliberately out of scope here** and referenced only as constraints.

**This document reflects an adversarial review.** A research + design pass (grounding research incl. live web search on the current India situation, 14 per-domain feature designs, and 3 adversarial critics — safety, misuse/legal, product) produced a draft; a human-rights digital-security lens then cut or constrained the most dangerous ideas. Where you see a limit, it is deliberate.

**Name:** **Harborage** — decided. A movement-neutral name (a *harborage* is a place of shelter or refuge), which also resolves the earlier neutrality concern: the platform is neutral civic infrastructure, not the apparatus of any single party or movement.

### Decisions locked this session (from the user)
1. **Scope: build everything.** All feature domains are in-scope for the product (not phased away). See §11 for honest *launch-readiness interlocks* — a way to build it all while not switching on a data-holding feature before its safety prerequisite exists.
2. **Public accountability: yes.** Public visibility of misconduct by police / public servants (and people posing as police in civilian dress) is in scope — implemented as responsible public accountability, **with the firm red lines in §4.10 and §12**.
3. **Live view: higher-immediacy.** A more real-time / more granular ground view than the ultra-conservative default — **with the one narrow red line in §4.5 and §12** (no live individual precise GPS, no persistent who-was-where log).
4. **Name: Harborage** (decided) — movement-neutral; a "harborage" is a place of shelter/refuge.

### Red lines held (transparency — please read)
The user chose the more capable option on three safety-sensitive features. I've honored those choices and built robust versions — but I am holding three narrow, well-justified limits, because crossing them would endanger the platform's *own users*, cross into facilitating harassment/violence, or be so legally radioactive it would get the project shut down and organizers prosecuted:
- **No public "target list."** We publicly document and name *official-capacity misconduct*; we do **not** publish home addresses, family, private contact/social accounts, or any "confront/find/retaliate" call to action. (§4.10)
- **No unverified identity claims about private-looking individuals.** Naming a plainclothes/"posing as police" person requires a high, corroborated, human-reviewed bar — misidentification gets innocent people hurt. (§4.10)
- **No live individual protestor tracking.** No public broadcast of one person's precise real-time GPS, and no persistent queryable who-was-where-when log — that specific capability is a targeting/kettling/arrest tool against your own people and an arrest map on server seizure. (§4.5)

Everything else the user asked for is delivered. If you want to revisit any red line, that's a conversation for the next session with civil-liberties counsel in the room.

---

## Session 2.5 updates — read this first (supersede earlier text where they conflict)

Later design passes refined this PRD. Where older wording below conflicts, these win:

- **Trust & moderation are autonomous-first (§6, §4.11 → ARCHITECTURE §15).** Because Harborage serves an *ongoing* protest with real use before human moderators can be vetted, AI + community + reputation drive verification labels, ranking, and hide-not-delete quarantine **from day 1**, with a low, honestly-labeled ceiling. AI is day-1 **core**, not deferred. The human review org is a **hardening** milestone, not a launch prerequisite — except the irreversible m-of-n gates (individual naming, unredaction, precise-location reveal, permanent deletion), which stay human-gated and ship **off**.
- **Evidence Archive (§4.4 → ARCHITECTURE §16).** A durable, deletion-resistant, storage-minimized open archive: a public redacted + verified + optimized layer plus the sealed E2E vault; nothing illegal ever becomes un-purgeable.
- **Resource Directory (new §14).** A public, verified, multi-city directory of **organizations / already-public resources** (mental health, legal aid, medical, safe spaces, journalists-for-testimony, human-rights orgs, financial-relief pointers, disability-inclusive services, kitchens / water / charging / accommodation / transport). It unifies the old §4.1 signed emergency-contacts (now its "Signed" tier) and §4.5 facilities (now its "PUBLIC_INFRA" type). Individual helpers and individual needs stay pseudonymous and **brokered** in §4.7–4.9 — never a public list of a named individual.
- **UX (new §15) is the authoritative UX / IA / content spec.** Five-tab bottom nav (Home, Stay safe, Record, Nearby, Directory), two front-door routers (Get help / Give help), plain language, no AI tells, honest four-label verification wording, and an honest quick-exit — these supersede older nav / label / safe-mode text.
- **Personas (§3):** add seeker (incl. students and persons with disabilities), volunteer / curator, and provider / org — client-held lenses, zero-account browsing, no role registry.
- **Corrections:** Tor / onion is opt-in and a minority path on PWA v1 (owned onion = later milestone; onion-only for life-safety flows), **not** "primary"; hosting is Workers Static Assets, **not** Pages; launch languages are **English + Hindi**. Full version pins are in ARCHITECTURE §14; IaC and the minimal runbook are in ARCHITECTURE §17 + RUNBOOK.md.

---

## 1. Mission & Guiding Principles

Harborage helps people engaged in **peaceful, lawful, democratic protest and human-rights documentation** coordinate safely, document abuses as durable evidence, get medical/legal/material help, hold official misconduct accountable, and receive trustworthy information — under surveillance, shutdowns, and disinformation. It is neutral civic infrastructure.

**Six non-negotiable principles. Every feature is evaluated against all six.**

1. **Peaceful & lawful.** Actively discourages violence, incitement, weapons, and attacks on individuals; supports non-violent assembly and human-rights documentation. *"Peaceful" is the hard red line; "lawful" is contested in practice in India — see §12.*
2. **Protestor safety first.** Assume a resourceful, hostile **state-level adversary** (surveillance, infiltration, legal coercion, network control). Every feature is assessed for how it could endanger a user; the safe path is the automatic default.
3. **Responsible accountability, not doxxing.** Hold *official misconduct* accountable publicly and preserve evidence for lawful oversight — never publish private-life data or calls to harass/retaliate against individuals. (§4.10)
4. **Truth & anti-manipulation.** Provenance, verification status, corroboration, and abuse-prevention are core features. Unverified content is labeled and never algorithmically amplified.
5. **Inclusion & resilience.** Works on low-end Android, low bandwidth, multiple Indian languages, low digital literacy, with accessibility, and degrades gracefully under partial or total internet shutdown.
6. **Open-source security.** Transparency must not become exploitability: secure-by-default, no secrets in code, signed/verifiable releases, supply-chain hardening, threat-informed contributions.

**Seventh, cross-cutting: honesty about limits.** False confidence gets people arrested. The product must plainly state what it *cannot* protect against (ARCHITECTURE §9.7).

---

## 2. Core Concept: the Incident

The **Incident** is the platform's central linking primitive — a structured record of a specific event of alleged police brutality or rights abuse (lathi charge, tear-gas, detention, denial of medical/legal access, custodial abuse, surveillance, communications shutdown).

Everything of consequence links back to an incident:

```
                         ┌─────────────────┐
        evidence  ──────▶│                 │◀────── legal matter (FIR, bail,
   (hashed, provenance)  │    INCIDENT     │         habeas, NHRC/SHRC complaint)
                         │  (structured,   │
   medical / medico-legal│   verification- │◀────── feed post (escalated)
        ──────▶          │   labeled,      │
                         │   geo-controlled│◀────── ground-situation signal
   mutual-aid (consent-  │  )              │
     gated link) ───────▶│                 │◀────── accountability record (official-capacity)
                         └─────────────────┘
```

Design rules for the incident object:
- **Structured, ACLED-style taxonomy** (typed: type, date, time-window, location at a controlled granularity, actor by *role/unit/official-identifier*, reported injuries/detentions, constrained narrative). Structured data is dedupable, analyzable, and moderatable; free-text-only is not.
- **Verification status travels with every incident** — Unverified / Corroborating / Verified / Disputed / Debunked — plus a corroboration count. Nothing is presented as fact.
- **Public view vs. sealed bundle are separated.** The public representation is scrubbed and redacted; the most sensitive/precise/identifying material (raw evidence, precise coordinates, witness identities) lives in client-side-encrypted bundles the platform cannot read.
- Incident *capture* is the most moderation-heavy and legally sensitive surface; it ships with — not before — its moderation and custody prerequisites (§11).

---

## 3. Personas & Roles

| Persona | Needs | Product posture |
|---|---|---|
| **Anonymous reader** (largest group) | Safety directives, know-your-rights, hotlines, accountability record, live conditions — instantly | Full public read surface with **zero account, zero login, zero connectivity required** |
| **Pseudonymous participant** | Post updates, coordinate, request/offer aid, submit evidence | On-device keypair, no PII; safe defaults automatic |
| **Verified official / organizer** | Publish trustworthy directives/notices | Role-bound signing keys, hardware MFA, m-of-n on high-stakes notices |
| **Trusted marshal** (event-scoped) | Verify ground signals, publish SAFE_EXIT / DISPERSAL | Least-privilege, time-boxed, 2-person publish on high-impact directives |
| **Community moderator / reviewer** | Triage, verify, quarantine, adjudicate | Least-privilege; **cannot enumerate users** (no member directory exists) |
| **Verified professional** (lawyer / doctor / journalist / medic) | Elevated trust for legal/medical/press work | In scope; ships **only** with a no-mapping / anonymous-credential verifier model (§12) — never a real-identity honeypot |
| **Legal-aid coordinator / lawyer** | Detention response, case tracking | Most identifying data stays lawyer-side/off-platform; platform holds references/hashes |
| **Accountability reviewer** | Adjudicate public official-misconduct records | Multi-person verification gate before any individual identity is published |
| **Contributor / maintainer** | Build safely | Threat-tiered review, signed commits, separation of duties |

**Structural invariants across all roles:** no real-name/phone/email requirement; **no member directory or "list all users" capability anywhere**; no interpersonal follow graph; privileged surfaces sit behind Cloudflare Access with phishing-resistant (passkey/hardware) MFA, off the public app.

---

## 4. Feature Domains

Each domain lists purpose, MVP features (with a one-line safety note), and later-enhancement features. **All domains are in scope**; §11 covers safety interlocks (a built feature can be gated behind a readiness check until its prerequisite exists).

### 4.1 Safety Directives & Know-Your-Rights Playbooks
**Purpose:** Authoritative, lawyer- and medic-vetted, offline, multilingual guidance so people act on trustworthy standing knowledge, not rumor.

| MVP feature | Safety note |
|---|---|
| Offline-first playbook library, full signed bundle precached | Whole-bundle fetch → no per-article read telemetry; lawful public reference, safe to possess |
| Signed, versioned, client-verified content with authenticity badge | Client-side signature check defeats a poisoned mirror/MITM; unsigned shown "UNVERIFIED — do not trust" |
| India-specific know-your-rights (BNSS arrest/production, DK Basu, 24h magistrate, women/juvenile protections) | Lawyer-reviewed, dated, cited; framed as lawful rights-assertion + de-escalation, never law-evasion |
| Medic-vetted first-aid cards (tear gas, baton trauma, crush, heat, hunger-strike) | Conservative, escalate-early; nothing repurposable to harm others |
| Digital-security & phone-protection guide, **region-aware** | Warns where a technique is itself restricted (e.g. unauthorized VPN in some regions) — never counsels blind illegality |
| Non-violence & lawful-conduct code, foregrounded | Structurally counters provocateurs; instructs disengage-and-report on incitement |
| Verified emergency-contacts directory (organizational only) | Only vetted org hotlines, never private individuals; numbers change only via signed update |
| Quick-access crisis cards ("Tear gas now", "I'm being detained", "Blackout") | Zero-network, one-to-two taps, minimal on-screen time |
| Shutdown-resilient signed distribution (mirrors, exportable / QR / peer packs) | Every bundle signature-verified on-device, so untrusted mirrors/peer copies are safe |

**Later:** IVR/USSD retrieval (listen-only), state-specific legal variants, audio narration & pictographic mode, printable QR posters, decision-tree wizard, community-suggestion editorial workflow, staleness auto-flagging.

### 4.2 Official Communications & Notices Channel
**Purpose:** A cryptographically-signed one-to-many broadcast channel, visibly distinct from user posts, so a forged "official" message cannot steer people into danger.

| MVP feature | Safety note |
|---|---|
| Signed notices, client-verified; signature + role-key + hash travel with the notice | Trust is cryptographic — a hijacked account or compelled CDN cannot mint a valid directive |
| Distinct official voice + in-app "verify the channel" page (key fingerprints, canonical domains) | Badge is signature-driven, not a settable flag; fingerprints published out-of-band survive domain blocking |
| Structured taxonomy (safety directive / logistics / legal-status / correction / detention-alert / transparency) | Location fields are area/landmark-level, never live individual GPS |
| m-of-n multi-sign on high-stakes directives (disperse, route-change, stand-down) | One seized/coerced/phished signer cannot issue a dangerous mass directive |
| Role-bound keys, fast revocation honored offline; append-only hash-chained log | Officials are roles, not doxxed people; corrections supersede transparently; history can't be silently rewritten |
| Phishing-resistant publishing surface (Access + passkey/hardware MFA) | Passkeys defeat credential phishing; console holds no protestor list, no raw private keys |
| Resilient multi-channel distribution + static crisis mode; SMS/print labeled **unverifiable** | Self-verifying notices survive DDoS/shutdown; unverifiable fallbacks can't become a spoofing back door |
| Anti-incitement + anti-doxxing pre-publish gate | Highest-reach channel gets the strictest gate |
| Transparency & warrant-canary notices (multi-signer) | A stale/missing re-signature signals compulsion |

**Later:** threshold signatures + hardware tokens, signed notices over audited mesh, two-way SMS/USSD/IVR, delegated regional sub-channels, separately-signed translations, key-transparency log, duress-resistant signing, scheduled auto-expiring notices, media provenance (C2PA).

### 4.3 Identity, Roles, Verification & Trust
**Purpose:** Participate and coordinate without the account ever becoming the thing that gets someone arrested. The safest system holds almost nothing about who anyone is.

| MVP feature | Safety note |
|---|---|
| Anonymous, no-account read of the entire public read surface | No login wall = no forced identity funnel during a crackdown |
| Pseudonymous account = on-device keypair; **no name/phone/email** | No real-identity registry to seize; SIM-linked identity never required |
| **Per-domain (and per-request for medical/aid) identity compartmentalization** | Unlinkable subaccounts so a seized store can't correlate one person's medical + legal + incident + aid activity |
| User-held recovery kit (mnemonic), honest "lose it = lose account" | No email/SMS recovery honeypot to phish or compel |
| Progressive trust tiers from behavior, not identity | Sybil farms start powerless; reputation stores no PII |
| Personhood-lite (Turnstile) on signup / high-reach actions; layered, never sufficient alone | Tuned to admit Tor/VPN; gates actions not reading; combined with rate-limits + reputation |
| Vouch/probation pathway, revocable; **vouch edges not persisted as a queryable graph** | Compute trust ephemerally; store a derived scalar — no who-trusts-whom map is seizable |
| Panic action = best-effort local clear + session revoke; duress PIN → decoy | Framed honestly as "clears the app view; does NOT protect a seized-and-examined phone" (ARCHITECTURE §9.7) |
| Phishing-resistant MFA (passkey/hardware) for all privileged accounts; no SMS OTP | Removes interception + SIM-linkage; anomaly alerts + fast revocation |
| No social graph, no member directory, per-post ephemeral identity, aggregation warning | The two most catastrophic records (network map, membership list) are architecturally absent |

**Verified-professional badges (in scope):** ship only atop **unlinkable anonymous credentials** (BBS+/blind-signature) or a verifier that retains **no** real-identity↔pseudonym mapping. Interim: org-vouching that retains nothing. Never a verification honeypot (§12).

**Later:** Shamir social recovery, sleeper-resistant web-of-trust reputation, E2E multi-device key sync, hardware-key distribution for organizers, scoped official sub-roles, duress-triggered silent trusted-contact alert, federated/self-hostable identity.

### 4.4 Incident Documentation & Evidence
**Purpose:** Capture, structure, and preserve credible evidence without endangering the filmer, victims, or bystanders — durable for lawful processes, resistant to both deletion and poisoning.

| MVP feature | Safety note |
|---|---|
| Structured incident record (controlled taxonomy; actor = role/unit/official-identifier) | UI routes private-individual PII away from public fields into the review-gated accountability path (§4.10) |
| Offline-first on-device capture with hash + signed provenance | Zero server contact; precise GPS never written into the media, only into the sealed encrypted bundle with consent |
| **Import from a source link** (Instagram Reel / YouTube Short / X / Facebook, etc.): fetch the actual media from the platform and store its **canonical content ID** (reel/video/post ID) | Dedupe by canonical ID **+ perceptual hash** so the same clip reposted under different URLs/params/wrappers collapses to one incident; preserves original provenance; the fetch is done server-side, disclosed, and must not leak which user requested it |
| Automatic PII scrub + **irreversible solid-fill redaction** of faces/plates/IDs (default on) | Solid-fill, not reversible blur/mosaic; **human before/after confirmation required** before posting people; fail-closed to vault |
| Vault vs. public-view separation (client-side encrypted sealed bundle) | Platform stores blobs it cannot read; the vault can't silently become a target list |
| Privacy-controlled geo/time (default coarse, jittered, density-floored, delayed for public copy) | No queryable who-was-where-when log from public evidence |
| Chain-of-custody ledger + §63 BSA (ex-65B) attestation export | Framed as evidence-preservation supporting lawful processes — **not** a court-admissibility guarantee |
| Corroboration/clustering + always-visible verification status | Coordinated fake bursts stay Unverified and un-amplified; clustering must not build a co-witness graph |
| Human-in-the-loop review, AI-assist triage (cheap-classifier-first, behind Turnstile + rate-limits) | AI never auto-publishes/auto-verifies; incitement/weapons tripwire auto-quarantines pending review |
| Manual redaction + consent-gated witness statements (vault-only by default) | No publishing a third party's account/identity without explicit per-statement scope |

**Interlocks:** reviewers act on already-redacted derivatives by default; unredacted source access is multi-person-gated, logged, rate-limited, watermarked, with reviewer-wellbeing safeguards. Evidence-vault keys must be **threshold/secret-shared or reporter-held + off-platform custodian** before capture ships — no single seized key unlocks the corpus (§11, §12).

**Later:** C2PA anchoring, recycled-media/deepfake detection (triage-only), OSINT verification aids, SMS/USSD intake, audited mesh relay, independent off-platform custodian replication, advanced on-device redaction, scheduled integrity re-verification + corpus warrant canary.

### 4.5 Live Ground Situation (higher-immediacy configuration)
**Purpose:** A near-real-time, safety-oriented picture of ground conditions and crowd presence — *where* things are happening, *roughly how many* people, and *what* is happening — while staying useless as a tool to locate an individual.

Per the user's "more real-time/precise" choice, this is tuned toward immediacy and granularity, with **one narrow red line held**.

| MVP feature | Safety note |
|---|---|
| Near-real-time **hazard/condition alerts** (TEAR_GAS, WATER_CANNON, LATHI_CHARGE, POLICE_MOVEMENT, ROAD_BLOCK, KETTLING_RISK, SAFE_EXIT, DISPERSAL, MEDICAL/AID_STATION) | Condition data is the life-saving core and carries far less targeting value than protestor-location; shortest acceptable delay; marshal-verified alerts near-instant |
| Zone-based board with **finer granularity** than the conservative default | Still a density/k-anonymity floor so no marker resolves to one identifiable person; **no self-location "I am here" GPS primitive** |
| **Coarse crowd-size bands** per zone (e.g. small / growing / large / very large) | Satisfies "how many people" with far less targeting value than a precise headcount |
| **Suppress-until-safe-density**: a gathering is hidden (or delayed) until it exceeds a safe minimum size at that location | Protects a small group from being pinpointed — a handful of people never becomes a visible dot on the board |
| **Community-verified facilities layer** (toilets, drinking water, charging, medical/aid tents, safe rest points, shade), with a **trust score that rises as more people independently verify** each spot | Public infrastructure is safe to show precisely; a verification threshold + trust score block fake or booby-trap entries; kept separate from protestor-location signals |
| Verification-state labels + corroboration count; 2-person marshal-verified SAFE_EXIT/DISPERSAL get alert treatment | Nothing trusted on one source; burst/anomaly checks route coordinated spikes to review |
| Trusted-marshal near-real-time layer (vouched, time-boxed, Access + hardware MFA) | Even the privileged view is zone-level, condition-focused |
| Safe Mode / panic degrade (one tap, no login) | Strips to text-only directives, wipes local situation cache |
| Short TTL + auto-purge of all situation data; minimal/no server retention of precise data | "We don't have it" stays true on seizure — no persistent conditions-by-place-by-time arrest map |
| Offline cached snapshot + static crisis view + exportable safety packs | Cached hazards carry timestamps + "may be outdated — verify locally" + TTL |
| Abuse-gated intake (personhood + rate limits before publish/AI) | Tuned to admit Tor/VPN; new/low-trust accounts can't alone cross corroboration thresholds |

**Red line held — will NOT build:** live broadcast of an individual protestor's precise real-time GPS to the public, and any persistent queryable who-was-where-when log. That specific capability is a direct targeting/kettling/arrest tool against the platform's own users and an arrest map on seizure. Everything the user asked for (where, roughly how many, what) is delivered without it.

**Tunable for the architecture session (with counsel):** exact publication lag per signal type, minimum zone size, density floor, minimum gathering size before a crowd is shown (suppress-until-safe-density), crowd-band thresholds (vs. precise counts — recommended against), facilities-verification threshold, marshal-alert immediacy, heightened-threat auto-degrade triggers.

**Later:** aggregate kettling early-warning (protective only), SMS/USSD directive fallback, audited mesh relay, crush-safety guidance, AI anomaly/recycled-media triage, accessibility/voice directives.

### 4.6 Community Feed / Mini Social Media
**Purpose:** A calm-by-design, location-aware community feed for updates, ideas, and coordination that never becomes a surveillance, doxxing, disinfo, or engagement-addiction vector.

| MVP feature | Safety note |
|---|---|
| Pseudonymous, optional per-post ephemeral identity; no follower/following lists | No persistent handle clustering; no seizable social graph |
| Area-based feed: coarse, jittered, delayed, density-floored; location off by default | No live precise tracking as a feature |
| Auto metadata-scrub + solid-fill face/plate redaction on all media (client-side before upload) | Public copy is always the stripped/redacted variant |
| Verification-state labels on every post/comment | No content presented as fact; unverified never amplified |
| Signal-boost / corroborate instead of like-counts; recency + corroboration ranking | No engagement maximization, no vanity metrics, no addictive loops |
| Follow **areas & topics, never people** | No interpersonal follow graph to seize |
| Escalate-a-post-to-Incident bridge | Enforces incident-grade scrubbing + reporter pseudonymity on graduation |
| Report/flag + anti-incitement tripwire + block/mute | Auto-quarantine (not delete) pending human review |
| Abuse gating: personhood-lite + rate limits + coordinated-behavior detection before any AI | No raw IP logging on protestor endpoints; tuned for Tor/VPN inclusion |
| Offline-first read + crisis mode; compose offline, deferred sync | Reading safety info never depends on live server contact |
| Anti-doxxing composer guardrail | Blocks private-life data (home/phone/family); genuine official-misconduct material routes to the accountability track (§4.10) |
| Threaded comments, **no in-feed DMs** | Prevents an unmoderated private-harassment channel |

**Later:** multilingual authoring + translation, low-literacy/voice posting, SMS/USSD fallback, semantic dedup/recycled-media detection, earned reputation tiers, structured deliberation board, community-notes contextualization, saved collections, export to Signal/mirrors, audited mesh sharing.

### 4.7 Medical Aid Requests & Coordination
**Purpose:** Get injured protestors help fast via verified medics, without exposing the injured person's identity or precise location.

| MVP feature | Safety note |
|---|---|
| Structured, low-literacy medical request with triage (no name/phone/account) | Never on the public map/feed; E2E to matched responders only; coarse area; short TTL |
| Verified medic/first-aider tiers (vouching + probation, no self-declaration) | Responders see only matched requests; no browsable list of injured people |
| Brokered ephemeral E2E channel with **late location reveal** | Precise meet-point shared late, to one accepted responder; disappearing messages; purge on resolve |
| Offline-first multilingual first-aid library | Bundled/precached; no view logging; works under shutdown |
| Medicine/supply board (non-urgent, brokered, category-not-diagnosis) | No public listing of who needs what; lawful medicines only |
| Request privacy controls: auto-expiry, cancel, best-effort panic-clear | Client-side encryption + short retention so a seized server/phone yields little |
| **Just-in-time safety briefing** — shown when a person creates a request, and to a responder on accept: risks, guidelines, safe-conduct tips | Protects the injured person *and* the responder before either commits |

**Interlocks:** timing-decorrelate the request→responder handshake (batch/delay/jitter); for life-threatening/precise-reveal cases prefer handoff at a known aid-station/tent, prefer org-affiliated responders, require corroboration (two responders) before precise reveal, cap acceptances per responder, alert on implausible patterns.

**Later:** medico-legal documentation linkage, confidential mental-health/trauma support, hunger-strike monitoring (high-liability — careful), hospital/clinic directory + MLC warning, medic-team logistics, SMS/USSD SOS fallback, aggregate anonymized injury statistics.

### 4.8 Mutual Aid (Food, Travel, Accommodation, Medicine, Supplies)
**Purpose:** Request/offer essentials, matched privately, while blocking the worst failure mode: being used to lure, trap, or map vulnerable people.

| MVP feature | Safety note |
|---|---|
| Structured need/offer posts (controlled categories, capped note) | No free-text-first; note scrubbed + classified before any counterparty sees it |
| Private brokered 1:1 matching — **no public marketplace/board** | No browsable needs/offers; no queryable who-needs-what-where log |
| Coarse geography, late meet-point reveal at **neutral public points**; **no home-address field ever** | Steers hand-offs to metro/market/clinic; anti-ambush guidance |
| Pseudonymous handles + masked ephemeral E2E relay (no phone exchange) | SIM = real identity in India; masked relay protects the aid network |
| Risk-tiered trust: higher bar for accommodation/medical/personal-transport | Rate-limited onboarding so a fresh account can't immediately offer to house/drive someone |
| Turnstile + rate limits + Sybil/coordinated-behavior defense before any AI | Report/block one tap; anti-scam warnings on donation asks |
| Match lifecycle + aggressive auto-expiry; fulfillment without location proof | No long-lived ledger of who helped whom |
| Anti-luring safeguards + one-tap "this feels like a trap" instant quarantine | Incitement/illegality tripwires block matches |
| **Just-in-time safety briefing on both request *and* offer creation**: tailored guidelines, risk disclosure, and safety suggestions before submitting | Protects both the protestor and the helper; informed consent is a precondition, not fine print |

**Interlock:** private-home short-term accommodation brokering is **surfaced only via vetted institutional shelters** (gurdwaras, NGOs) with organizational accountability — not stranger-to-home matching (host legal exposure + entrapment vector).

**Later:** pooled funds/donations (FCRA/fraud — via registered orgs only, careful), community-kitchen/langar logistics, SMS/USSD + mesh intake, trusted-org helper attestation, recurring aid, voice-first low-literacy flow.

### 4.9 Public Assistance Offers (Legal / Medical / Journalistic / Translation / Skills)
**Purpose:** Let the public offer help and connect it to verified open needs, without exposing helpers, protestors, or victims.

| MVP feature | Safety note |
|---|---|
| Structured helper intake / skills registry (pseudonymous, district-level, closed taxonomy) | Registry never publicly browsable; a supporter list is a target list — minimize + short-retain |
| **No public directory** — gated, brokered, pull-based matching with late mutual reveal | No list-all; contact via E2E relay; two-sided verification before reveal |
| Helper vetting, probation, least-privilege compartmentation | A "driver" never sees medical PII; an "amplifier" never sees case evidence |
| Consent & privacy controls + panic-hide + one-tap withdrawal + **just-in-time safety briefing on offer creation** | Privacy-by-default; tailored risks/guidelines/safe-conduct tips shown before a helper commits — protecting helper and protestor alike |
| Two-sided anti-honeypot: **verify need provenance before any helper is exposed** | Defeats fake "needs" planted to lure/entrap real lawyers/doctors |
| Peaceful/lawful skill guardrails (no violent/tactical/doxxing categories) | Incitement tripwire + mandatory conduct code |

**Later:** automated match scoring, credential-body integrations (verify-then-discard), privacy-preserving reputation, rapid legal-aid on-call dispatch, shift scheduling, confidential counselor track, remote micro-task board, trusted-org federation.

### 4.10 Public Accountability & Legal-Action Tracking
**Purpose (per user):** Publicly hold accountable the misconduct of police / public servants (and people posing as police in civilian dress) against peaceful protestors — *and* turn incidents/detentions into tracked lawful action (FIR, bail, habeas, NHRC/SHRC). This is public accountability **plus** case management — implemented responsibly.

**A. Public accountability (what we build):**

| Feature | Safety / integrity note |
|---|---|
| Public incident records with verified evidence of official misconduct | Only Verified/Corroborated records are surfaced as accountability; verification status always shown; "alleged" framing until adjudicated |
| **Official-capacity identification** by official identifiers — badge number, rank, unit/station, and name where officially established / on the record — tied to specific documented incidents | Public officials' *official conduct* is legitimately subject to scrutiny; identity claims pass a multi-person accountability-review gate before publication |
| **Institutional accountability dashboard** — patterns and counts by unit/station/rank; status of complaints/FIRs/NHRC cases; whether accountability is progressing | Highest public-interest value, lowest individual-harm risk; emphasize this over individual naming |
| Right of reply / correction / dispute mechanism; prominent removal path | Named individuals can contest; errors are correctable fast |
| Presumption-of-innocence framing throughout | "Documented allegation under lawful process," never "guilty" |

**B. Legal-action & detention tracking (mostly off-platform):**

| Feature | Safety note |
|---|---|
| Detainee intake & jail-support tracker (Art. 22 / DK Basu 24h clock, trusted-contact fan-out) | Detainee real-name data stays on the assigned lawyer's device, off-platform; platform holds opaque references; no browsable detainee directory |
| Legal-matter records linked to incidents by reference (hash + case number) | Store references, not raw PII; public views redacted and coarse |
| Statutory deadline & hearing calendar with alerts | Alerts carry opaque references ("Matter #X needs action"), never case facts; content-free notification path (ARCHITECTURE §9.4) |
| Encrypted case-document vault + §63 BSA attestation export | E2E to case-participant keys; framed as preservation, not admissibility |
| Role & legal-review access-control model with consent registry | No "list all"; duress/panic lockout so a coerced coordinator can shut down rather than mass-disclose |

**Firm red lines (will NOT build — these are how "public accountability" avoids becoming "a target list"):**
- **No private-life data, ever:** no home addresses, personal phone numbers, family members, private (non-official) social accounts, or personal-life details of any individual — official or not.
- **No call to action against individuals:** no "wanted"/bounty framing, no "confront/find/locate/retaliate," no invitation to harass. The anti-incitement tripwire runs at maximum strength on this surface.
- **High bar for private-looking individuals ("posing as police"):** publishing an *identity claim* about a civilian-appearing person requires corroborated, reviewable evidence + accountability-review sign-off, because crowdsourced misidentification gets innocent bystanders hurt. Absent that bar, the platform publishes the **evidence, the conduct, and the accountability demand** — not an unverified "this is [name]."
- **No unverified accusations presented as fact;** single-source identity claims are withheld or shown as under-review, never asserted.

**Why these lines (state plainly to the team):** they keep the feature as *accountability journalism / official-conduct transparency* (legitimate, defensible, high public interest) and out of *harassment/vigilantism* — which would (a) get people harmed via misidentification and retaliation, (b) hand the state a pretext to brand the platform a criminal doxxing operation and shut it down / prosecute organizers, and (c) expose contributors to defamation and worse.

**Interlocks:** accountability publication and detention-response require the accountability-review function, legal-role key management, and counsel sign-off before switch-on (§11, §12).

**Later (off-platform-biased):** guided complaint/petition drafting, bail/surety coordination, de-identified systemic-litigation analytics, controlled watermarked data-room exports, eCourts/cause-list integration, offline legal-rights packs.

### 4.11 Fact-Checking, Moderation & Abuse Prevention
**Purpose:** Protect information integrity and users from disinfo, astroturf, infiltration, incitement, and doxxing — while protecting legitimate protest voices from wrongful takedown. **AI is strictly assistive; humans decide.**

| MVP feature | Safety note |
|---|---|
| Verification-state model + honest labels; reach earned by verification, not engagement | State-changes logged append-only so silent up-labeling is detectable |
| AI-assisted triage queue (cheap-classifier-first, behind Turnstile + rate-limits + spend caps) | AI flags/down-ranks/narrow-quarantines only; never autonomous delete/publish; E2E/private content never sent to AI |
| Community flagging + structured corroboration, reputation-weighted | Coordinated identical flags are a manipulation signal, not consensus; flags never auto-remove |
| Recycled-media / provenance matching (**canonical source-ID + perceptual hash**, coarse signals) | Same clip reposted via different URLs/params/mirrors collapses to one; operates on detached minimized signals; absence of provenance shown neutral, never as guilt |
| Turnstile + layered rate limits + personhood-lite (**no phone/SIM gate**) | No raw-IP logging on protestor endpoints; tuned to admit Tor/VPN |
| Coordinated-inauthentic-behavior detection (behavior-only, ephemeral, **no persistent social graph**) | Human confirms before throttling; legitimate coordinated posting is expected |
| Least-privilege moderator roles, vouching, audit trails (behind Access + MFA) | No member directory to harvest; multi-person approval for high-impact actions |
| Anti-incitement + anti-doxxing tripwire (**quarantine, then short-purge**) | Retaining a store of violence-intent content + PII is legally radioactive — keep a minimal non-content audit record, not the payload |
| Graphic-content handling: warn, redact, **preserve — don't auto-delete** | Evidence preserved off-feed in encrypted custody; public copy face/plate-redacted behind interstitial |
| Appeals + retain-during-appeal + transparency reports + warrant canary | Makes both over-moderation and compelled takedowns visible and reversible |

**Anti-weaponization:** rate-limit and reputation-weight who can trip auto-quarantine on another account; treat coordinated tripwire-triggering (e.g. framing a victim's ephemeral identity) as manipulation.

**Later:** semantic multilingual claim-matching, deepfake detection assist, partner fact-check federation (BOOM/Alt News/ClaimReview), community-jury appeals, prebunking/media-literacy nudges, moderator campaign-analytics.

### 4.12 Access, Inclusion, i18n, Low-bandwidth & Offline
**Purpose:** Reach the most at-risk and least-served — low-literacy, low-bandwidth, low-end Android, multilingual, disabled, shutdown-affected. **Inclusion is a safety feature.**

| MVP feature | Safety note |
|---|---|
| Multilingual UI + human-reviewed safety-critical strings (English, Hindi + Punjabi, Bengali, Tamil, Telugu, Marathi, Urdu…) | Safety strings never machine-translated; two-person reviewed; versioned/hash-revocable; language stored on-device only |
| RTL + complex-script correctness, subsetted **self-hosted offline fonts** | No third-party font CDN (breaks under shutdown + leaks which script/community a user reads) |
| Simple Mode (icon-first, controlled pictograms, always icon+label+optional audio) | Any safety-consequential action shows an explicit confirm defaulting to the safe/no-data choice |
| Voice/audio-first delivery + WCAG-2.2-AA (TalkBack, 200% scaling, high-contrast, no color-only meaning) | No autoplay; only generic public content read aloud |
| Low-bandwidth / tiny-footprint offline-first PWA (Data-Saver default on slow links) | On-device downscale + metadata-strip before upload; heavy fetches opt-in with shown data cost |
| Offline safety pack (precached + exportable, device-to-device) | Generic lawful content only — defensible to possess, one-step deletable |
| Shared/borrowed-device mode (ephemeral by default, one-tap clear) | Guest read path stores nothing; no sensitive content in notifications/lock-screen |
| Graceful degradation / no-JS read path for old WebViews & proxy browsers | Degraded path is read-only public info — nothing sensitive transits an untrusted proxy |
| SMS broadcast fallback — **public signed directives only, outbound only** | SMS subscriber list = SIM-linked identity list → carries only already-public content, opt-in with plain warning, minimized, never linked to in-app identity |

**Hard rule:** low-trust channels (SMS/USSD/IVR/no-JS/proxy) carry **only already-public, signed, non-personal broadcast content** and **never accept sensitive input** (location, detention status, aid, incident, identity).

**Later:** IVR (listen-only), USSD lookups, community translation platform, on-device voice input (raw audio discarded), transliteration/cross-script search, audio/pictographic onboarding, audited P2P offline sync.

### 4.13 Open-Source Governance, Community Ops & Sustainability
**Purpose:** Keep the platform demonstrably community-led, peaceful, lawful, and trustworthy over time, and ensure "open source + near-zero-ops GHA" never becomes an attack surface against vulnerable users.

| MVP feature | Safety note |
|---|---|
| Peaceful & lawful charter + enforceable Code of Conduct (versioned in-repo) | Explicitly forbids target-lists, incitement, doxxing; gives moderators defensible grounds and rebuts "this is a violence tool" framing |
| Threat-informed contribution process (risk-tiered paths, CODEOWNERS, ≥2 reviewers on sensitive paths, secret-scanning merge-block, pinned action SHAs) | A single compromised contributor/reviewer can't weaken a user-protecting default |
| Coordinated security disclosure + researcher safe harbor (encrypted, identity-optional intake) | De-anonymization bugs are P0; coordinated disclosure prevents a weaponizable public 0-day window |
| Governance & maintainer trust model (least-privilege, separation of duties, 2-person rule, coercion + succession handling; project ≠ any one movement) | No single infiltrated/coerced maintainer can backdoor or forge |
| Pseudonymous volunteer/translator/moderator onboarding (vouch + probation, **no member directory**) | No seizable roster; review-before-merge on localized strings blocks translation-as-attack |
| Warrant canary + coarse transparency reporting (multi-signer) | Detects compulsion even under gag order |
| Privacy-respecting, FCRA-aware funding via offshore fiscal host; software funds walled off from protest/aid money; minimal donor data | Avoids handing the state an FCRA pretext or a seizable donor list |
| Supply-chain / near-zero-ops CI hardening (OIDC short-lived scoped tokens, build/deploy separation, protected workflow files, signed verifiable releases) | A single automation compromise can't silently ship a backdoored build |
| **Standing abuse/ethics red-team gate + per-feature kill switches + heightened-threat mode** | Independent reviewer veto before any data-holding feature ships; rapidly disable accountability publication / location tagging / detainee intake / low-trust channels during a live crackdown |
| Localized, offline-exportable user + governance docs | Safe path is understandable without connectivity |
| Project incident-response & continuity playbook (compromised key, forced takedown, breach) | Pre-rehearsed key-revocation, mirror/fork continuity, honest signed user notification |

**Later:** independent foundation + formal governance, funded audits + bug bounty, reproducible builds with public verification, contributor reputation ledger, localization platform, federation/forkability governance, diversified grants.

---

## 5. Protestor Safety & Threat Model

### 5.1 Adversary
A resourceful, hostile **state-level adversary**: telco/ISP traffic inspection and IP logging, IMSI catchers, mandated internet shutdowns and DNS/SNI blocking, CDN/hosting legal pressure (US + India reach), device seizure and coercive unlock, legal compulsion, infiltration and agents-provocateurs, disinformation/astroturf operations, opportunistic doxxers/vigilantes. **Assume the adversary can see *that* a user connected and possibly *from where*, even without content.** Metadata and traffic-correlation — not breaking content crypto — is the dominant capability.

### 5.2 Top risks → product-level mitigations

| # | Risk | Product mitigation |
|---|---|---|
| S1 | De-anonymization (metadata, faces, aggregation) | Auto metadata-scrub; irreversible solid-fill redaction with human confirm; pseudonymity; per-domain compartmentalization; no social graph; aggregation warning |
| S2 | Legal seizure/compulsion of platform data | Data minimization + short retention + auto-expiry; client-side E2E on sensitive surfaces; most incriminating data (detainee ID, case docs) off-platform; warrant canary |
| S3 | Real-time tracking via map/feed | No individual-location primitive; coarse + density-floored zones; crowd bands not precise counts; short TTL + purge; **no persistent who-was-where log** |
| S4 | Forged "official" notices | Cryptographic signing + client verification; m-of-n; role keys + fast revocation; append-only log; unverifiable channels labeled |
| S5/S6 | Evidence poisoning / disinfo flooding | Verification states + corroboration thresholds; manipulation detection; no virality-by-default; human-in-the-loop; recycled-media checks |
| S7 | DDoS / shutdown at key moments | Offline-first PWA, static crisis mode, signed exportable packs, mirrors + .onion; Tor is opt-in/minority on PWA v1, onion-only for life-safety flows (owned onion = later milestone; ARCHITECTURE §9.2) |
| S8 | Infiltration to privileged role | Least-privilege, no member directory, vouch+probation, multi-person grants, audit trails, kill switches |
| S9 | Phishing of privileged accounts | Passkey/hardware MFA only, no SMS OTP, Access-isolated surfaces, anomaly alerts |
| S10 | Supply-chain / CI compromise | No secrets in repo, OIDC scoped tokens, signed verifiable releases, protected workflows, ≥2 reviewers on sensitive paths |
| S11 | **Accountability → doxxing/harassment/misidentification** | Official-capacity + official-identifier only; multi-person verification gate; **no private-life data, no call-to-action**; high bar for private-looking individuals; right-of-reply + fast correction |
| S12 | Aid-request exploitation / entrapment | Private brokered matching, no public boards, late reveal at public points, timing decorrelation, org-affiliated responders + corroboration |

### 5.3 Substrate-level requirements (blockers, not "later")
- **App-code integrity is the root of trust.** Client-side scrub/redact/E2E/signing/panic are worthless if the edge can serve a poisoned client. Ship an installable, independently-verifiable build (signed release, integrity-pinned service worker, path to reproducible builds); strongly consider a signed native APK channel (F-Droid/direct) for high-risk users. Until integrity verification exists, publish the honest limit.
- **"No IP logging" is not a promise we can make.** Reword to: "the app does not retain IPs, but the network edge and your ISP still see your connection." Make Tor/.onion a first-class primary path for sensitive writes; add timing decorrelation to the highest-risk handshakes.
- **No third-party push for sensitive events.** Detention/medical/legal alerts use content-free poll-on-open or a platform-controlled long-poll, never FCM/APNs. Any push is limited to already-public, zero-payload broadcast and disclosed as revealing app membership.

### 5.4 The live-view tradeoff — explicit (per user's higher-immediacy choice)
Real-time ground data is the most useful *and* most dangerous surface. The user chose more immediacy; the design delivers it via **near-real-time hazard/condition alerts + finer (still density-floored) zones + coarse crowd-size bands + suppress-until-safe-density (a small gathering isn't shown until it is large enough to be non-identifying) + short-TTL/no-retention**, and **holds one red line: no live individual precise GPS broadcast and no persistent who-was-where log** (§4.5). This is the maximal capability that does not turn the platform into a targeting/arrest tool against its own users. Concrete parameters (lag, zone size, density floor, band thresholds) are set in the architecture session with counsel.

---

## 6. Trust, Moderation & Anti-Disinformation
- **Verification-state model everywhere:** Unverified (default) / Corroborating / Verified / Disputed / Debunked + corroboration count + provenance summary. **Reach is earned by verification, never engagement.**
- **AI is strictly assistive.** Cheap-classifier-first triage behind Turnstile + rate-limits + spend caps; AI flags/down-ranks/narrow-quarantines only; **a human makes every removal/verify decision;** AI never touches E2E/private content.
- **Community corroboration + reputation-weighting** (behavior-only, no identity, no persistent social graph); coordinated identical flags treated as manipulation, not consensus.
- **Peaceful enforcement** via a narrow, quarantine-first incitement/weapons tripwire (explicit violence/weapons/targeting — not general anger), short-purge of payloads after adjudication, anti-weaponization limits.
- **Anti-doxxing enforcement** via composer-level PII gates, redaction-by-default, and routing accountability material to the review-gated track (§4.10). **No public perpetrator target list exists.**
- **Wrongful-takedown protection:** mandatory appeals, retain-during-appeal, multi-person approval for high-impact actions, tamper-evident audit trails, transparency reports, warrant canary.
- **Reviewer protection:** redacted derivatives by default; unredacted access multi-person-gated, logged, rate-limited, watermarked; exposure caps + wellbeing safeguards.
- **Honest bottleneck:** human review capacity is the true constraint and gates the switch-on of user-generated-content surfaces (§11).

---

## 7. Security, Privacy & Resilience
- **7.1 Privacy-by-default:** no real name/phone/email; safe values (location off, metadata-scrub on, redaction on, ephemeral) ship as defaults; no member directory; no social graph; no queryable who-was-where log; data minimization + short retention + auto-expiry.
- **7.2 On-device protections (honestly framed):** metadata scrub before bytes leave the phone; irreversible solid-fill redaction with human before/after confirm and fail-closed-to-vault; per-domain/per-request identity compartmentalization; optional client-side encryption on surfaces exposing vulnerable individuals (aid, medical, precise evidence, case docs). Public evidence/feed stays server-readable so it can be verified — a stated tradeoff.
- **7.3 Honest-limits contract (first-run + always-available, multilingual):** plainly states what the tool cannot protect against — a seized-and-examined phone (panic-wipe is best-effort, not forensic-grade); edge/ISP metadata (app use is itself observable and can be treated as participation evidence); redaction accuracy floor; no court-admissibility guarantee.
- **7.4 Censorship & shutdown resilience:** offline-first installable PWA; static read-only crisis mode; mirror domains + Tor .onion + published key fingerprints via multiple channels; exportable/printable/QR/device-to-device signed packs; region-aware circumvention guidance; SMS/USSD/IVR carry only public signed broadcast content, outbound; capture + directives work with zero server contact.
- **7.5 Open-source security posture:** no secrets in repo (secret-scanning merge-block); signed commits + signed verifiable releases; branch protection + CODEOWNERS + ≥2-maintainer review on auth/crypto/location/evidence/CI paths; pinned dependency + action SHAs + SCA; OIDC short-lived scoped CI tokens with build/deploy separation; `security.txt` + coordinated disclosure + safe harbor. Reproducible builds + PWA code-integrity verification are foundational blockers.
- **7.6 Design references (proven tools to borrow, not reinvent):** model E2E messaging and metadata-resistance on the **Signal Protocol** — X3DH key agreement, Double Ratchet forward-secrecy, **sealed-sender** metadata minimization, disappearing messages, and safety-number / key-verification — but **not** Signal's phone-number identity; keep the pseudonymous-keypair model, closer to **Session** (a Signal-Protocol fork with no phone numbers) and **Briar** (Tor-based, serverless, with offline Bluetooth/Wi-Fi mesh — directly relevant to §7.4 shutdown resilience). For evidence and field safety, borrow **Guardian Project** tooling: **Tella** and **ProofMode** (verifiable, provenance-preserving capture), **Orbot/Tor** (transport), and **Haven** (physical/device security). These set the safety bar for §4.3–§4.10; concrete protocol selection is a Session-2 (architecture) decision.

---

## 8. Build Scope & Launch-Readiness Gates (replaces "phasing")

Per the user's "build everything" decision, **all 13 domains are in product scope.** But a data-holding feature is a *liability* until its safety prerequisite exists, so we use **launch-readiness interlocks**: a feature can be fully built and merged, yet stays behind a readiness check + kill switch (§4.13) until its gate is met. This honors "everything at once" without switching on a half-wired safety feature over real people.

**Recommended build order (so the team isn't blocked; not a scope cut):**
1. **Foundations (everything depends on these):** shared client shell (offline PWA, i18n, Simple Mode, safe defaults, crisis mode); app-code integrity (signed release, pinned service worker, reproducible-build path); content signing + client verification + key ceremony/revocation; distribution-under-blocking (mirrors, fingerprints, QR/peer packs); governance minimum (charter, CoC, threat-tiered contributions, CI hardening, disclosure + safe harbor, abuse-review gate + kill switches); honest-limits contract; Turnstile/rate-limits tuned for Tor/VPN.
2. **Signed knowledge + broadcast (lowest risk, immediate value):** Safety Directives & KYR (§4.1); Official Notices (§4.2); Access/Inclusion/Offline (§4.12); account-free read + optional pseudonymous accounts (§4.3).
3. **Participation + documentation:** Incident capture & evidence (§4.4); Community feed (§4.6); Fact-check/moderation as a staffed function (§4.11); escalate-to-incident bridge.
4. **Coordination + help:** unified brokered-matching engine serving Medical (§4.7), Mutual Aid (§4.8), Public Assistance (§4.9).
5. **Live + accountability + legal:** Live Ground Situation (§4.5); Public Accountability + Legal/Detention tracking (§4.10).

**Readiness gates (each blocks *switch-on*, not *building*):**

| Feature area | Gate before it can go live |
|---|---|
| Incident capture / evidence vault | Threshold/off-platform key custody + reviewer-protection process |
| Feed, aid-matching, accountability publication | Staffed, multilingual, trauma-aware human moderation + review capacity |
| Any sensitive-data holding (medical, legal, detention, accountability) | Legal operating entity + Indian civil-liberties counsel sign-off |
| Public accountability naming | Accountability-review function + verification bar operational (§4.10) |
| Live ground marshal layer | Marshal vetting/verification process live |
| Verified-professional badges | Anonymous-credential / no-mapping verifier (§4.3) |

---

## 9. Cloudflare-native feasibility (confirmation only — not architecture)
Every capability maps to a real Cloudflare primitive, so the stack is viable (details deferred to Session 2): app/edge → Workers (Static Assets); realtime live board → Durable Objects/WebSockets; relational data → D1; media/evidence → R2; sessions/cache → KV; scheduled/queue jobs → Cron/Queues; bot/abuse defense → Turnstile + WAF + Rate Limiting; privileged access → Access/Zero Trust; AI triage → Workers AI/external; broadcast email → Email. **Known hard parts to solve in architecture:** client-code integrity vs. edge-served client; E2E vs. edge processing tension; Cloudflare's own jurisdiction + "what if Cloudflare is blocked in India"; AI-moderation cost/DoS; GHA-only secret handling (OIDC).

---

## 10. Explicitly Out of Scope / Will Not Build
For safety, ethics, and legal reasons, the platform **will not** build:
- **A public target list** — no home addresses, family, private contacts/social, or personal-life data of any individual (official or not); no "wanted"/bounty/"confront/find/retaliate" framing. (Accountability = documenting *official misconduct*, §4.10.)
- **Unverified individual identity claims presented as fact** — especially for private-looking ("posing as police") people; these require a corroborated, human-reviewed bar or are withheld.
- **Live precise individual protestor tracking** — no "I am here", no live precise self-location broadcast, no queryable who-was-where-when log. (Conditions and coarse crowd bands only, §4.5.)
- **Anything facilitating violence** — no weapons/"tactical"/attack-coordination content or offensive signaling; incitement is quarantined and enforced against.
- **A member directory or social graph** — no follower/following lists, no contact import, no "list all users", no persisted vouch/coordination graph.
- **Real-identity or phone/SIM-based identity, recovery, or 2FA** — no phone/email required; no SMS OTP; no email/SMS account recovery.
- **Sensitive input over low-trust channels** — SMS/USSD/IVR/no-JS carry only public signed broadcast content, outbound.
- **Third-party push for sensitive/targeted events** — no routing of detention/medical/legal membership+timing through FCM/APNs.
- **Private-home accommodation brokering** — institutional vetted shelters only.
- **Money brokering / pooled funds / bail transfers early on** — FCRA/fraud/traceability; only via vetted registered orgs if ever.
- **Reversible obfuscation sold as redaction** — irreversible solid-fill only.
- **Forensic-grade claims for browser wipe/decoy**, or **court-admissibility guarantees** — framed honestly as best-effort and evidence-preservation.

---

## 11. Launch-Readiness Interlocks (summary)
See §8. Principle: **build everything; switch on nothing that holds real people's data before its safety prerequisite exists.** Every data-holding feature ships behind a per-feature kill switch and a heightened-threat mode that can disable it instantly during a live crackdown.

---

## 12. Key Open Decisions (for Session 2 / counsel — resolve before build)
1. **PWA vs. native for high-risk users** — panic-wipe/duress-decoy and key custody are best-effort in a browser. Ship a signed native APK channel for seizure-exposed users, and when?
2. **Legal operating entity & jurisdiction** — who is on the hook, reachable where? Gates which sensitive data may be held at all. Needs Indian civil-liberties counsel.
3. **"Peaceful" vs. "lawful"** — in India peaceful assembly is often deemed unlawful; where exactly is the line between non-violence (the red line) and blanket legal compliance? Shapes offerable content/coordination.
4. **Accountability naming policy — final counsel review** — exact evidentiary bar for naming an official; exact (higher) bar for a private-looking individual; correction/removal SLA; defamation/UAPA exposure of contributors. This is the single most legally sensitive feature — do not ship without counsel.
5. **Verifier honeypot** — who could hold (or avoid holding) the identity↔pseudonym mapping for verified professionals with legal resilience? Anonymous credentials are the real fix.
6. **Evidence-vault key custody** — threshold/secret-shared vs. reporter-held + off-platform custodian? Which partner org?
7. **Detainee data & incommunicado trigger** — how much identifying data ever touches servers vs. lawyer's device only; abuse-resistant trigger design.
8. **Notification path** — confirm content-free poll/long-poll for sensitive events; acceptable use (if any) of third-party push for public broadcast.
9. **Tor/metadata posture** — make .onion the sensitive-write path for life-safety flows (opt-in/minority on PWA v1; owned onion is a later milestone); which flows need timing decorrelation; acceptable latency.
10. **Shutdown-fallback ownership** — which SMS/IVR/USSD gateway, in what jurisdiction; which fallbacks are safe to ship in which regions (VPN/mesh criminalization).
11. **Live-view parameters** — concrete lag, corroboration threshold, minimum zone size, density floor, crowd-band thresholds; whether marshal-verified SAFE_EXIT may be faster.
12. **Root-of-trust bootstrap** — who anoints the first official signing keys; how a new user learns a genuine fingerprint out-of-band when the primary domain is blocked.
13. **Moderation operations** — who staffs multilingual, trauma-aware, protest-day-scale human review under legal risk, and how are they protected and compensated?
14. **Source-media import** — third-party-platform ToS/legal for server-side fetching of Reels/Shorts/videos; copyright/storage posture; how to fetch without revealing which user is interested.

---


---

## 14. Resource Directory, Volunteer Coordination & the "One Place" Experience

Harborage folds the vision's *"centralized, verified, browsable database of help"* into the platform as **one new domain** that unifies three things that already overlap in the docs — the signed emergency-contacts directory (PRD §4.1), the community-verified facilities layer (PRD §4.5), and the newly-requested resource categories — behind a **single table, single taxonomy, single trust pipeline, single offline pack**. It ships on day 1, offline-first, en/hi, WCAG-2.2-AA, zero-account.

The three folded design drafts proposed three divergent schemas, state machines and tier vocabularies for the same table; the critique is correct that this is unbuildable. **This deliverable collapses them to ONE canonical model** (below) and **cuts day-1 scope to the smallest thing a scared user can actually use in two taps offline**, deferring the autonomous-curation machinery to the milestone where a curator population and the channels to reach it actually exist.

### 1. The central reconciliation: split by listed-entity type, not by policy toggle

The vision wants a *public, browsable, verified* directory. The safety stance (CLAUDE.md red lines; PRD §5) forbids a public *target list* of supporters or a *need map* of victims. These reconcile through a **hard structural split keyed on what kind of entity is listed** — enforced in the schema, not by a setting:

| Listed entity | Why it's safe/needed | Surface | Model |
|---|---|---|---|
| **Organization / already-public resource that consents to be found** — NGO, community kitchen, langar/gurdwara, water/charging station, org-run safe space, legal-aid org, clinic/hospital, HR org, hotline, disability service, relief initiative, verified journalist/testimony desk | Being findable is *the point*; consented + already public | **PUBLIC, browsable, verified, multi-city directory** | This domain (`resource_entries`, PUBLIC-PLAINTEXT) |
| **A specific named individual helper** — this lawyer, this doctor, this driver, this host | A list of named supporters = a supporter target list | **Never browsable** | Existing skills registry → gated brokered pull-match (PRD §4.9) |
| **An individual seeking help** — a student, a protestor, a PWD seeker | A list of needs = a victim map | **Never browsable** | Existing brokered 1:1 (PRD §4.7/§4.8) |

**Invariant DIR-1 (schema-enforced):** every `resource_entries` row carries `entity_type ∈ {ORG, PUBLIC_INFRA, INITIATIVE}` and **has no column that can hold a natural-person identity, a home address, a seeker's need, or a money amount**. A solo practitioner who wants to be found is admitted only as a *practice/service entity* under organizational accountability, or is redirected into the §4.9 brokered path. There is no row shape for "individual X helps protestors."

**Invariant DIR-2 (schema-enforced):** Harborage **brokers no money**. Financial/relief entries are *pointers* to a registered initiative's own donation/help channel — no amount field, no payment field, no in-platform transfer (FCRA/fraud red line; consistent with §4.8's "no amount/payment field ever").

### 2. One unified entry model (folds in §4.1 + §4.5)

Three `entity_type`s live in one table so there is one intake, one trust pipeline, one search index, one offline bundle — no divergent code paths:

- **`PUBLIC_INFRA`** — the old facilities layer: toilet, water, charging, aid-station, rest-point, shade. Precise coords allowed (public infra is safe to show precisely). **Physically segregated from protestor-density signals**, exactly as ARCH §6.1 requires — never joinable to the live board.
- **`ORG`** — an organization/venue with premises: legal-aid org, clinic/hospital, org-run safe space, HR org, counselling service, gurdwara, community kitchen.
- **`INITIATIVE`** — a campaign/pointer with no walk-in premises: relief fund, testimony-intake desk, transport-assistance coordinator. Contact-only, typically no address.

The old §4.1 signed emergency-contacts become `ORG`/`INITIATIVE` rows at the **`Signed`** verification tier (numbers change only via signed update). The old §4.5 facilities become `PUBLIC_INFRA` rows. **One directory model now subsumes both.**

### 3. Canonical category taxonomy (closed, versioned, signed)

No free-text categories (a poisoning + i18n-drift vector). One closed `category` + optional `subcategory`, shipped in the signed taxonomy/i18n pack so labels render offline in en/hi and can't be tampered client-side:

```
MENTAL_HEALTH        { psychologist, psychiatrist, counsellor, trauma_support, crisis_hotline }
LEGAL_AID            { legal_aid_org, bail_support, habeas_desk, know_your_rights_clinic }
MEDICAL              { hospital, clinic, first_aid_post, ambulance, healthcare_hotline }
SAFE_SPACE           { rest_shelter, overnight_shelter, charging_refuge, womens_safe_space }
JOURNALIST_INTAKE    { testimony_desk, verified_media_org }            // brokered/own-URL only, §7
HUMAN_RIGHTS_ORG     { hr_org, monitoring_org, documentation_org }
FINANCIAL_RELIEF     { relief_fund, emergency_assistance, legal_cost_fund }  // pointer only, DIR-2
DISABILITY_INCLUSIVE { accessible_service, sign_language, assistive_support, accessible_transport }
COMMUNITY            { free_meals, community_kitchen, water_station, charging_point,
                       temporary_accommodation, transport_assistance }
EMERGENCY_CONTACT    { org_hotline }                                   // folds in §4.1 (Signed tier)
FACILITY             { toilet, water, charging, aid_station, rest_point, shade }  // §4.5, PUBLIC_INFRA
```

`temporary_accommodation` is admitted **only** as `entity_type=ORG` with organizational accountability (gurdwara / NGO / institutional shelter) — preserving §4.8's interlock (never stranger-to-home). `DISABILITY_INCLUSIVE` is **both** a category and a cross-cutting filter.

### 4. Entry data model (PUBLIC-PLAINTEXT) — one canonical schema

New D1 table `resource_entries` (single unsharded, every filter column indexed per the ARCH §4.2 lint rule). All columns are public-plaintext by construction:

```
resource_entries
  id                 TEXT  ULID (opaque; no time/identity/location encoded)
  entity_type        TEXT  ENUM(ORG, PUBLIC_INFRA, INITIATIVE)              [idx]
  category           TEXT  ENUM(...)                                         [idx]
  subcategory        TEXT  ENUM(...)                                         [idx]
  name_i18n          TEXT  provider/org name (public; never a natural-person contact name)
  region_bucket      TEXT  signed region code, e.g. IN-DL, IN-PB-LDH         [idx]  // multi-city key
  coarse_geohash4    TEXT  always present (~20 km) for coarse filter          [idx]
  geohash6           TEXT  NULL unless visibility_tier=PUBLIC_ADDRESS         [idx]
  address_i18n       TEXT  NULL unless visibility_tier=PUBLIC_ADDRESS
  contact_method     TEXT  ENUM(PHONE, URL, WALK_IN, IN_APP_BROKER)          // BROKER = M4 only
  contact_value      TEXT  the org's OWN published phone/URL; NULL if IN_APP_BROKER
  hours_json         TEXT  structured, offline-renderable
  languages          TEXT  ISO codes served, e.g. ["hi","en","pa"]           [idx]
  accessibility      TEXT  bitflags {wheelchair, sign_language, step_free,
                           accessible_toilet, audio_assist, low_sensory}      [idx]
  visibility_tier    TEXT  ENUM(PUBLIC_ADDRESS, CONTACT_BROKERED)            [idx]
  verification_state TEXT  ENUM(SelfListed, Corroborating, Verified, Signed, Stale, Quarantined) [idx]
  trust_score        INT   materialized 0–100 (§5)                           [idx]
  corroboration_cnt  INT   distinct independent verifiers
  is_core_infra      INT   bool — hand-verified seed / critical infra (never auto-hidden, §5) [idx]
  last_verified_ts   INT
  consent_ref        TEXT  opaque hash of the signed provider-consent record (§6)
  status             TEXT  ENUM(LIVE, HIDDEN, QUARANTINED)                    [idx]
  pack_epoch         INT   signed rollup epoch this belongs to
  -- ABSENT BY DESIGN (DIR-1/DIR-2): no owner→person map, no home_address,
  -- no individual_contact_name, no amount/payment, no seeker/need linkage,
  -- no who-verified-what edge, no visitor/query log.
```

**Two visibility tiers** (provider-chosen at intake):

- **`PUBLIC_ADDRESS`** — precise `geohash6` + address shown. For walk-in-safe resources (kitchen, water station, hospital, gurdwara, org office wanting footfall). **This is the entire day-1 tier.**
- **`CONTACT_BROKERED`** — browsable by name/category/region, but **no address/precise coords ever emitted**. *Day 1, "contact" is the provider's OWN published hotline/URL* (`contact_method=PHONE|URL`, geohash/address NULL) — this needs no broker and already covers the large majority of "listed but not pin-mapped" sensitive providers. The true in-app relay (`contact_method=IN_APP_BROKER` via the Broker DO) is **deferred to M4**, shipped once as shared machinery with medical/mutual aid — not a directory-specific dependency.

### 5. Verification, trust-score & anti-poisoning (honest about day 1)

A fake "safe space" is a trap; a fake "lawyer" is a honeypot. The directory rides the platform's existing trust vocabulary (PRD §4.3/§4.11, ARCH §6) plus a facilities-style trust score (§4.5). **State ladder:**

| State | Meaning | Public? |
|---|---|---|
| `SelfListed` | Provider/volunteer submitted, uncorroborated | Shown **only** for low-risk categories, clearly labelled "Self-listed — not yet confirmed"; **never** for safety-critical categories |
| `Corroborating` | ≥ K distinct independent corroborations | Yes, "Confirmed by N people" |
| `Verified` | Corroborating + org-vouch, or human reviewer sign-off (safety-critical) | Yes, "Verified" badge + basis |
| `Signed` | m-of-n org/founding-org signature (seed pack, official relief funds, §4.1 hotlines) | Yes, top label; edits only via signed update |
| `Stale` | No re-corroboration in T days | **Still shown**, degraded to "May be outdated — verify locally" badge + deprioritized ranking (see below) |
| `Quarantined` | Report threshold or reviewer flag | Hidden pending review |

**Honest day-1 framing (critique blocker #1 — applied).** The autonomous community-verify loop **cannot bootstrap on launch day**: with no accounts, no roster, and a memory-only coordinator, there is no channel to tell a volunteer in Ludhiana that a VERIFY task is pending, so a purely community-fed directory would sit *empty*. Therefore day-1 value comes from exactly two sources, stated plainly:

1. a **founding-org-curated `Signed` seed directory**, compiled + human-verified per launch city and shipped as a **signed offline pack** (the §4.1/knowledge-pack mechanism); and
2. **provider/volunteer self-intake landing in a human-triaged `console` queue** that the founding org promotes.

The autonomous layer's day-1 guarantee is precise: **"nothing unsafe auto-publishes"** (it fails toward *empty/hidden*), **not** "the community autonomously fills the directory." Community-verify is an **M2** feature with an explicit precondition — *a reachable, active curator population exists in region X* — not a launch claim.

**Anti-poisoning that does NOT hand the adversary a kill switch (critique blocker #4 — applied):** quarantine power is a **function of entry trust, not a flat threshold**.

- `SelfListed` / community-only entries: report-as-unsafe is instant-quarantine-eligible (fail toward hidden — correct for unverified rows).
- **`Signed` / `Verified` / `is_core_infra` seed entries can NEVER be community-auto-hidden.** Reports on them raise a **human-review flag** while the entry **stays visible** with a soft "a report is under review" note. Two sock-puppets must not be able to erase the safe-space list during a crackdown.
- Reputation-weighting + coordinated-identical-report detection (CIB, §4.11) still apply: mass-identical reports are a *manipulation signal routed to review*, never consensus.

**Staleness degrades, never deletes core help (critique blocker #5 — applied):** staleness moves an entry to `Stale` = a **"may be outdated, verify locally" badge + deprioritized ranking**. It **never removes** a `Signed` / `Verified` / `is_core_infra` entry (a hand-verified hospital or langar disappearing is strictly worse than showing it stale). Only low-trust `SelfListed` entries drop out on decay. **Consent-TTL auto-hide is deferred** to a later milestone gated on a working provider re-contact path; seed consent is captured once by the founding org at intake and is not TTL-expired.

**AI is assistive only** (§4.11/§7.4): Tier-0 lexical + anomaly detectors flag suspicious intake (a "legal aid" entry whose contact is a personal number; an address colliding with a known police station; a burst of identical entries) → routes to the human queue. **AI never autonomously publishes or deletes.** Everything is hide-not-delete → a wrongly-quarantined shelter is recoverable.

### 6. Provider intake + informed consent

Structured, closed-taxonomy, consent-first (never free-text-first). **Flow:** provider (zero-account) submits name, category, region, languages, accessibility, hours, own contact, and **chosen visibility tier** → an **informed-consent gate** (a precondition, not fine print — the §4.7 JIT pattern) states plainly *what becomes public at each tier* ("At PUBLIC_ADDRESS your name + precise location appear on a public map browsable with no account, in a hostile-surveillance context; choose the no-address option if that is unsafe"), the report/remove path, and records a **signed consent record** (`consent_ref` = opaque hash) → entry lands `SelfListed`/`HIDDEN` in the **human-triaged console queue** → founding org/maintainer promotes. **Remove-if-compromised** is one tap on every card (→ immediate HIDE, fail toward hidden), plus a public "report as unsafe/compromised." Turnstile + layered rate-limits + Sybil/CIB defense on intake (§4.11), tuned to admit Tor/VPN, no raw-IP logging.

Volunteer-sourced adds funnel through the **identical** pipeline — a volunteer's add is just a `SelfListed` intake needing corroboration; one volunteer cannot self-publish.

### 7. Journalists-for-testimony & financial relief (special-cased)

- **`JOURNALIST_INTAKE`**: listed as an `ORG`/`INITIATIVE` intake desk (city, languages, "accepts: X") whose contact is the desk's **own published intake URL** (day 1) or the in-app broker (M4). The directory **never lists a testimony-giver**; the giver connects through the brokered consented channel and/or the evidence archive (§4.4).
- **`FINANCIAL_RELIEF`**: pointer entries only (DIR-2). Card shows the initiative name, its own donation/help channel, verification label + trust-score, and a standing anti-scam warning (§4.8). Harborage never touches funds.

### 8. Multi-city navigation, discovery & search (closes the audit's discovery gap)

**Region model:** `region_bucket` = signed hierarchical code (`IN-DL`, `IN-PB-LDH`, …), shipped in the offline bundle. Navigation is **region → category → subcategory → filters**; multi-city is just a region facet. **Filters** (all indexed): category/subcategory, region, languages, accessibility flags, visibility tier, verification-state, open-now, trust-score floor.

**Serving — Cron-materialized, no live scan, no query log:** a Cron sweep recomputes trust-scores, applies staleness (badge, not removal for core), and materializes **per-`(region, category, lang)` rollups** + a **signed per-city directory pack** into R2 + KV + edge cache. Public browse hits the materialized rollup, never a per-request DB scan.

**Search is over the public pack only** — a client-side, offline-capable index over the already-downloaded region pack (name/category/language/city). Because it runs on already-public, already-downloaded content, **there is no server-side query to log** — the audit's "no query logging" is satisfied by construction. **Never user/identity search** — the schema has no person rows to return (DIR-1). A **compromised-resource fast-path** can force an out-of-band pack re-publish + SW cache-bust for urgent removals rather than waiting a full Cron cycle.

**Offline-pack budget (critique — applied):** packs are **per-city, never national**, with a hard byte budget (target: small tens of KB gzipped for essential card fields). The precached client index is minimal (name/category/language/city). Long descriptions and secondary i18n load on demand. A city pack lazy-loads on first selection with the download cost shown.

### 9. Volunteer / curator coordination (pseudonymous, reputation-based, no roster)

Volunteers research, verify, de-duplicate, translate and accessibility-audit **only the public organizational directory** — never individuals. The hard boundary (DIR-1) is schema + CI enforced: a "named individual" proposal is refused and routed to the brokered registry.

**Day-1 posture (critique blocker #6 — applied):** the volunteer "task board" on day 1 **is the founding org using the existing `console`** (Access + MFA), not a new product. Curators are **not an account type** and there is **no roster, no enumeration endpoint** (CLAUDE.md §4). Corroboration is counted as **PII-free per-entity counts** (dedup via `HMAC(per-entity salt, reporter_pubkey_hash)` with `UNIQUE(entity_id, dedup_token)`), never a who-verified-what edge.

**Deferred to M2+ (built only once a reachable curator population exists):** blind-token / Privacy-Pass curator reputation; client-side contribution receipts minting reputation credits; the HKDF curation compartment; the `CurationCoordinator` DO task board (VERIFY/REFRESH/DEDUP/TRANSLATE/ACCESSIBILITY/OUTREACH/TRIAGE); **fuzzy LSH/BK-tree dedup**; cross-city anti-fork merge tooling; the `region_notice_epoch` follow/pull system. **Day-1 dedup is exact-key only** (same E.164 phone **and** same registrable domain → auto-merge; anything fuzzy waits for M2 human `DEDUP_REVIEW`).

### 10. The unified "one place" home + role model

**Role is a client-held lens, never a server identity.** All roles land on the *same* URL and the *same* materialized home; the lens only re-orders and re-labels surfaces on-device (`{lens, region, language, follows[]}` in IndexedDB, wiped by panic/Safe Mode). No role registry, no "I am a protestor" flag ever leaves the phone.

| Role (client lens) | First-run path | Zero-account surface | Crosses into pseudonymous only when… |
|---|---|---|---|
| **Public / affected person** | Home → crisis cards + directory | All reads | contributing/reporting (optional) |
| **Protestor** | Home → live conditions + crisis cards + "Get help privately" door | Read surface + coarse live board | requesting medical/mutual aid; submitting an incident |
| **Person-seeking-help** (incl. students, PWD) | Home → category grid | Browse + call all `PUBLIC_ADDRESS`/own-hotline orgs directly, offline | contacting a brokered provider (M4), or disclosing a need |
| **Volunteer** | Home → "Help maintain this" → region | Read + propose/report (personhood-gated, low weight) | curation duties → maintainer key behind Access + MFA |
| **Provider / Org** | Home → "List your service" | Zero-account sealed self-intake | (M4) receives a rotating broker prekey if choosing brokered contact |

**≤2-tap zero-account onboarding, with no hard wall (critique — applied):** the app **lands immediately on a national-default home** with crisis cards + the category grid **rendered and actionable before any region choice**; region is a **refinement banner** ("Set your city for local results"), never a gate. Language defaults from device locale with a one-tap switch. First call-to-action — *tap a category → see a number → call* — is above the fold and works offline from the shipped default pack. **A keypair is minted lazily** only at the Bridge or first contribution.

**Home composition, re-ordered per lens (critique — applied):** the person-seeking-help lens strips the home to essentially **crisis cards + category grid + facilities**, demoting live-summary / archive / contribute to a secondary position. Full stack (crisis cards → notices → live summary → directory → facilities → private-help door → KYR → archive → contribute) is available but never a wall for a distressed user.

**Accessibility as first-class** (WCAG-2.2-AA): Simple Mode icon+label+optional-audio cards; `accessibility` bitflags are a filter *and* `DISABILITY_INCLUSIVE` is a category; no color-only meaning; 200% scaling; a no-JS read path serves the static region pack; audio playback of generic public entries + crisis cards. en/hi day 1, safety-critical strings human-reviewed, never machine-translated (§4.12).

**The Bridge (public → private brokered):** the one crossing from PUBLIC-PLAINTEXT to E2E. Triggered by "contact this brokered provider / request help privately." Flow: **JIT safety briefing (must acknowledge)** → **lazy compartment-scoped keypair** → **structured compose** (closed taxonomy, no home-address field ever) → **seal client-side** → **Broker DO** (memory-only, content-blind, jittered) → **brokered 1:1** (two-sided anti-honeypot, late location reveal, auto-expiry). The seeker's need is *only ever* a sealed envelope — never a public row, never a queryable log. **This whole path is M4** (shared with §4.7–4.9); day 1, the sensitive-provider case is served by the provider's own published hotline/URL with no address.

### 11. Day-1 usable core vs. later — explicit

**Day 1 (M1-adjacent, ships on the signed-pack + console machinery that already exists):**
1. Signed per-city **seed directory pack** (`Signed`/core-infra entries), founding-org-curated + human-verified.
2. Zero-account **offline browse** with **city × category × language** facets.
3. **Client-side search** over the precached pack (no query log).
4. **Provider/volunteer self-intake → human-triaged `console` queue**.
5. **Exact-key dedup** (phone + domain) only.
6. **`PUBLIC_ADDRESS` (public address/phone) + own-hotline "no-address" entries** only.
7. Folds in §4.1 emergency-contacts (`Signed`) and §4.5 facilities (`PUBLIC_INFRA`).
8. Client-held role lens; ≤2-tap onboarding with no region gate; Simple Mode + accessibility filters; per-category kill switches; degrade-safe reads.

**M2 (precondition: a reachable, active curator population in region X):** community-verify pipeline (K-corroboration, reputation weighting, trust-score, report→quarantine for self-listed only); volunteer contribution funnel beyond the console.

**M4 (with the shared Broker DO):** `CONTACT_BROKERED` in-app relay tier; brokered journalist-testimony handoff; the Bridge for the directory.

**Later / human-hardened:** blind-token curator reputation + contribution receipts; `CurationCoordinator` task board; fuzzy LSH dedup + cross-city merge; follow-epochs; consent-TTL auto-hide (gated on a re-contact path); trusted-org federation / bulk signed imports; IVR/USSD/SMS **outbound-only** directory lookup.

---

## 15. UX, Information Architecture & Content Design

This is the single source of truth for how Harborage looks, reads, and works. Where the earlier drafts disagreed, this section decides. Build from this, not from the older notes.

The shape in one line: a calm two-choice Home, a five-tab bottom bar, two routers that hide fifteen features behind plain questions, and safety plus language fixed to the same corner of every screen.

---

### Core principles (these settle arguments)

1. **One primary action per screen.** Everything else is smaller, quieter, or one tap away.
2. **Icon plus label, always.** No icon stands alone. Labels are short, in the user's language.
3. **Plain words, no drama.** "Get help." "Not checked yet." Never shouting, never jargon.
4. **Everything reachable in 2 to 3 taps.** From the five tabs, every feature is at most two taps away. If it takes three, it is filed wrong.
5. **Don't overwhelm.** Show 5 to 6 choices at a time. Reveal advanced things only when asked.
6. **Works offline and says so honestly.** No pretending. Stale or unsent items say so plainly.
7. **Looks ordinary.** Nothing about the default screen signals "protest app" to someone glancing over a shoulder.
8. **Non-reader first.** If a scared, low-literacy, non-English person can succeed, everyone can.

---

### Navigation model (one model, no hamburger)

A **five-tab bottom bar** is the spine. It is fixed, always visible, always icon plus label, in the thumb zone. There is **no hamburger menu.** A hidden menu fails stressed and low-tech users, so nothing important is ever hidden behind one.

| Tab | Label EN | Label HI | Holds |
|---|---|---|---|
| 🏠 | Home | होम | The two hero actions plus a few big cards |
| 🛡️ | Stay safe | सुरक्षा | Crisis cards, rights, notices. Fully offline |
| 📷 | Record | रिकॉर्ड | Capture, hide faces, save or send evidence |
| 🧭 | Nearby | आस-पास | Ground conditions and area updates |
| 📖 | Directory | सूची | Verified orgs and resources, browsable by city |

Five is the ceiling. Tapping a tab always opens that section's top screen. The active tab is filled, colored, and bold.

**Settings** (language, text size, identity backup, safe mode, offline, "how checking works") lives behind a small gear at the top-right of Home. It is not a tab and it holds nothing a user needs mid-crisis. Everything a person needs fast is in the five tabs, never settings-only.

**The two hero actions do not get their own tabs.** "Get help" and "Give help" are the whole top of Home. As tabs they would shrink to icons. On Home they can be large, labelled, and colour-coded. Home is one tap away from anywhere, so the heroes are always two taps out at most.

**Back behaviour.** On-screen back (top-left) and hardware back do the same thing. Within a section, back steps up the tree. At a section top, back returns to Home. Quick-exit overrides everything and drops to the neutral Directory view.

**Deep links.** Every screen has a real URL, for example `/stay-safe/teargas` or `/directory?city=delhi&need=legal`. A notice or a helper can point someone straight at a card. Device-local things (identity, a saved record) are not shareable, by design.

---

### Sitemap / IA tree

```
HOME  🏠
├─ GET HELP (router)  →  "What do you need?"
│   ├─ A doctor or medicine ............ [7 medical]  → directory list + private ask
│   ├─ Food, water, shelter, charging .. [8 mutual aid]
│   ├─ Legal or rights help ............ [1 rights] + [directory legal] + [10 intake]
│   ├─ Someone to talk to .............. [directory mental health] + [9 offers]
│   ├─ Record what happened ............ → RECORD
│   ├─ More things you might need ....... → browse all (icons, no typing)
│   └─ Call a helpline .................. persistent, always one tap
│
├─ GIVE HELP (router)  →  "What can you offer?"
│   ├─ Food, water, shelter, charging, ride  [8]
│   ├─ Medical / legal / counselling / a skill  [9]
│   ├─ Add or check a resource ......... [14 volunteer]
│   ├─ Share what you are seeing ....... [6 posts] / [5 conditions]
│   └─ More ways to help ............... [10 accountability] / [15 archive]
│
└─ (home cards: Stay safe · Nearby · Directory · Record)

STAY SAFE  🛡️   (fully offline, no account)
├─ Crisis cards (vertical stack, all visible)
│   ├─ If there is teargas
│   ├─ If you are detained
│   └─ If the network is down
├─ Staying peaceful
├─ Know your rights
└─ Notices (official, signed)  [2]

RECORD  📷   (evidence)
├─ New record → Add photo / write / record audio
│            → Hide faces (draggable blur) + exact location removed
│            → Add what happened (optional)
│            → Keep on phone (default) / Send to archive / Share with a legal partner
└─ My records (on this phone only)   → feed [15] + [10] when sent

NEARBY  🧭   (coarse, delayed, zone-level)
├─ Conditions by area (calm / caution / avoid) with a plain timestamp  [5]
├─ Safe ways out (coarse direction, never a route from your spot)
├─ Area posts, each with a plain checking label  [6]
└─ Add an update

DIRECTORY  📖   (verified, multi-city)  [13]
├─ Browse by category (big icon chips)
│   Mental health · Legal aid · Medical · Safe spaces · Journalists ·
│   Human-rights orgs · Kitchens / water · Charging / stay / transport ·
│   Financial relief · Disability-inclusive
├─ Filter chips: city · language · open now · disability-access
├─ Resource detail (what, where safe to go, checking label, contact)
└─ Add a resource  [14]  (quiet link for most, full tools for volunteers)

── top-right of every screen ──
अ/A  language toggle      Close  quick-exit
── top-right of Home ──
⚙  Settings: language · text size · identity + backup [3] · safe mode · offline · how checking works
```

---

### Home (the hub)

Top to bottom, one column, no horizontal scroll:

1. **A quiet header.** App name small on the left. On the right: language toggle (अ/A), a gear (settings), and a plain **Close** control (quick-exit).
2. **Get help.** Filled with the accent colour, on top, largest text in the app. Big open-hand icon. Subtitle: "Medical, legal, food, safety." This is the button a distress user's eye lands on without reading.
3. **Give help.** Outlined, below, clearly secondary. Same width, calm. Subtitle: "Offer what you can."
4. **Four big cards, stacked:** Stay safe · Nearby · Directory · Record.
5. **One thin line:** current city, and "Offline. Showing saved information." only when offline. Tapping the city opens the picker.

The two heroes are **not equal weight.** Get help wins the eye. A person who cannot read should still reach for the right one.

That is the whole screen. No feed dump, no stats, no onboarding wall, no signup. First launch drops straight here.

---

### GET HELP and GIVE HELP (the routers)

The heroes are routers, not features. Each opens one screen of large, plain choices. This is the move that keeps fifteen features from overwhelming anyone. The user never sees fifteen things. They pick a direction, then a need. Each list is about **five choices plus a "More" row**, so nothing scrolls on a small screen.

Every category row has an icon, a plain label, and (where audio exists) speaks aloud on focus. "More things you might need" opens a **browse-all screen of icon chips**, not a search box, so a non-reader never has to type. A plain **"Call a helpline"** row sits on the Get help router and in every empty and offline state, so a phone number is always one tap away.

---

### Core flows (short step lists)

**A. Seek help** (2 to 3 taps to a useful list)
1. Home → Get help.
2. Pick a need (doctor, food, legal, someone to talk to, record something, more).
3. See a list of verified places from cache: checking label, open-now, coarse distance, one action (Call or Directions).
4. Below the list: "Ask for help quietly" (the private path). Public browse is always offered first.

**B. Give / post help** (four taps plus a little typing)
1. Home → Give help.
2. Pick what you can offer.
3. Say who: yourself, or an organisation. (Orgs get a checked badge after review.)
4. Short form: what you have, roughly where (area, not an address), when (Now is preselected), how to reach you (in-app message by default, no number shared). "More details" is collapsed. Only "what you have" is required. Then Post.
5. Confirm: "Posted. Shown as Not checked yet. People can still reach you now." The on-device key is made silently here, in one plain line.

**C. Stay safe** (2 taps, fully offline)
1. Home card or 🛡️ tab → Stay safe.
2. Tap a crisis card. Cards are a **vertical stack**, so teargas, detained, and blackout are all visible without swiping.
3. The card shows numbered "Do this now" steps and a short "Don't." One honest closing line ("General safety advice. Not medical or legal advice."). Two next-step buttons at the bottom. All cards ship in the app in EN and HI and never need the network.

**D. Record an incident** (guided, easy to hide faces)
1. 📷 tab → New record. One calm line: "This stays on your phone until you send it."
2. Add a photo, write, or record audio. Exact location is removed on import.
3. Hide faces: drag a blur box over each face or plate. Undo is always there. Plain confirm: "Exact location removed."
4. Add what happened (optional).
5. Choose: **Keep on phone** (default), Send to the archive, or Share with a legal partner. You can send later.

**E. What's happening** (coarse, delayed, honest)
1. 🧭 tab → Nearby.
2. See area conditions (calm / caution / avoid) with a plain timestamp ("about 15 minutes ago"). Zone-level only, no pinpoints, no individual dots.
3. "Safe ways out" gives coarse direction, never a route from your spot.
4. Below: area posts, each with a checking label. "Add an update" posts as "Not checked yet."

**F. Public → private bridge** (the moment a browse becomes a personal ask)
1. From "Ask for help quietly" or "Get a medic."
2. First time only: a small note, three bullets, about 30 words. "Goes to trusted volunteers, not the public. You don't share your name, number, or exact spot. Share only what's needed." Remembered after.
3. Short ask: need (pre-filled from the category), roughly where (this area), how urgent (Now / Soon / Anytime).
4. Waiting screen is never empty: it offers the matching crisis card and the nearest listed camp while a volunteer replies in a brokered thread. No numbers exchanged. Notifications say only "You have a new update."

---

### Content and voice standard

Write for the hardest reader first. If a sentence needs a second read, cut it.

**Plain-language rules**
- Max 12 words per sentence for safety and action copy. Max 15 elsewhere. One idea per line.
- Use the common word. "Use" not "utilise." "Show" not "display." "Send" not "submit." "Posts" or "updates" not "feed."
- Active voice, verb first. "We hid the faces you marked." Address the reader as "you."
- Present tense. Digits for numbers. Round times: "about 10 minutes ago."
- A button says what happens when you press it. A label says what a thing is. Never make the user infer.

**NO AI TELLS: the ban list**
- No em-dash chains. Use a full stop or a comma. Split the sentence.
- No exclamation marks in safety copy. Rare elsewhere.
- No rhetorical-question openers. "Get medical help," not "Need medical help?"
- No filler openers: "Certainly," "Sure," "Let's dive in," "Let's get started," "In this section."
- No fake-ease words as reassurance: "simply," "just," "easily."
- No marketing words: seamless, robust, leverage, elevate, empower, unlock, streamline, cutting-edge, powerful, effortless, one-stop, curated (as a boast), journey (as a metaphor).
- No hedging: "it seems," "it appears," "please note that," "kindly," "in order to."
- No emoji as decoration in body or safety copy. (Icons paired with text labels are fine.)
- No tricolon clichés ("fast, simple, and secure"). No drama ("Your voice matters," "Together we rise"). No fake warmth ("We're here for you 24/7"). No corporate apology.
- The test: read it aloud. If it sounds like a brochure, a chatbot, or a press release, rewrite it.

**Honest verification labels (one system, everywhere the same)**

Four labels, no more. A person never meets a new checking concept. Each is a drawn shape plus a word. Colour is decoration only, never the sole signal. The AI or scoring machinery is **never shown to the public.** Anything a person or team has not confirmed is simply "Not checked yet."

| Label EN | Label HI | Meaning (on tap) | Shape + colour |
|---|---|---|---|
| Verified by our team | हमारी टीम ने जाँचा | Someone on our team confirmed this and its contact. | ✓ filled green |
| Confirmed by people nearby | आस-पास के लोगों ने पुष्टि की | Local users marked this as real. Not team-confirmed. Use your judgement. | ◎ outlined |
| Not checked yet | अभी जाँचा नहीं गया | No one has confirmed this. Be careful. | ○ grey outline |
| Reported as a problem | इसमें समस्या बताई गई | People flagged this. It may be wrong or old. Check before you rely on it. | ! grey with warning |

The chip shows the **short word first,** at chip size. The full sentence sits behind the tap. Never say "verified" unless a person verified it. Never hide "Reported as a problem" to look tidy. Honesty is the product.

**Before / after**

- Home hero. Before: "Welcome to Harborage! Your all-in-one platform to seamlessly access support." After: "Harborage. Get help, or give help. No account needed."
- Consent. Before: "By proceeding, you acknowledge captured media may contain personally identifiable information." After: "Photos can show faces and places. Hide faces before you send. Send only what you are okay to share."
- Checking. Before: "Community-validated (Trust Score 0.72), pending staff verification." After: "Confirmed by people nearby." (Tap to read what this means.)
- Send failure. Before: "Error: submission failed (network timeout)." After: "This did not send. Your work is saved on your phone. We will send it when you are back online."
- Detained card. Before: "In the unfortunate event you find yourself subject to detention, it is advisable to remain composed." After: "If you are detained: Stay calm. Do not resist."
- Notification. Before: "New medical request from Sarah near India Gate, tap to view." After: "You have a new update."

**Frozen strings (★ human-reviewed, quote verbatim everywhere)**
- Get help / मदद लें · subtitle: "Medical, legal, food, safety."
- Give help / मदद दें · subtitle: "Offer what you can."
- Quick-exit control: "Close" (not "PANIC," which is itself a tell).
- Home tagline: "Get help, or give help. No account needed." (No blanket "It stays private." Privacy is stated at the point of each action instead.)

---

### i18n

- Launch EN and HI. Build so more languages drop in with no code change. Design for Devanagari now, right-to-left (Urdu) from the start with logical CSS properties.
- All text in message files. No hardcoded strings. ICU MessageFormat for plurals and gender. No string concatenation to build sentences; use named placeholders (`{city}`, `{count}`).
- No idioms, slang, or puns. No text baked into images.
- Language toggle (अ/A) is on every screen, top-right, and remembered on device. **No first-run language gate.** Default to the device locale, drop the user onto Home, keep the toggle always visible. Show each language in its own script.
- Human-translate and human-review every ★ string: heroes, crisis cards, consent notes, identity and location notes, quick-exit. Machine translation only for low-risk content, labelled draft until a human confirms. Keep a review record with a named reviewer.
- **One canonical version of each crisis card** (teargas, detained, blackout, peaceful conduct), two-person reviewed. Card text appears in one place and is referenced, never copied.

---

### Accessibility (day-1 acceptance criteria, WCAG 2.2 AA)

- Tap targets at least 48 by 48 px, 8 px apart. Heroes are full-width, at least 64 px tall.
- Text contrast at least 4.5:1; large text and icons at least 3:1. Colour is never the only signal; every status has a word and a shape.
- Base body text 17 px. Safety copy 18 px. Support system text scaling to 200 percent with no clipping. Never disable zoom.
- Every control has a clear label. Every icon has a text alternative or is marked decorative. Reading order matches visual order; heroes come first. State changes are announced ("Offline," "Sending," "Sent," "Hidden").
- "Big text and simple mode" reduces choices, enlarges text, hides extras, works fully offline. This is the **primary** low-literacy support because it always works.
- Read-aloud ("Listen") is an enhancement, not a relied-upon path. Show it only when a voice for the current language is present. For the heroes and top categories, ship short pre-recorded audio in the app bundle so recognition never depends on device text-to-speech, which is unreliable offline on cheap Android.
- Respect reduced motion fully. No flashing. No action depends on hover, long-press, or drag alone; always give a plain tap path. Visible focus outline on every control.

---

### Visual and interaction direction

- Single column, max content width 560 px. Bottom bar of five tabs. Sticky full-width primary button above the nav on any screen with a main action.
- **No horizontal scroll on any primary path.** Crisis cards are a vertical stack. Category lists are short with a "More" row.
- Two building blocks only: a **card** (icon, title, one detail line, checking chip, one action) and a **list row** (56 px min, icon, title, chevron, checking chip). Learn two, build every screen.
- Calm neutral base, one scarce accent (muted teal), semantic colours only on small elements and always with an icon and word. Hazard is burnt orange, never siren red. Red-soaked screens read as panic and as "app for troublemakers."
- Two font weights only, Noto Sans plus Noto Sans Devanagari, self-hosted, subset to woff2, under about 120 KB total. System-font fallback while loading.
- Skeletons, not spinners, for content. Instant cached app shell. Honest connection state as a thin quiet strip, never a scary modal. Queued actions say so: "Saved. Will send when you're back online."
- Minimal motion. No pulsing, no auto-play, nothing on hazard elements. Transitions 120 to 200 ms, dropped to instant under reduced motion.

**Quick-exit and discreet mode (safety, not gimmick).** The default app already looks ordinary: plain name, no slogans, no flags, no fists. **No fake calculator.** A discovered costume is a worse tell than an ordinary-looking civic app, and a PWA cannot reliably swap its icon or control the recent-apps thumbnail, so we do not promise those. Quick-exit is a plain **"Close"** control, top-right on every screen, that in one tap clears sensitive view state and drops the user on the neutral Directory view. Discreet mode (in Settings, off by default) tones the accent down and keeps sensitive text out of previews. Notifications never carry sensitive content, ever, lock-screen safe by design.

**Honest limits, stated in copy and docs.** Device-local storage does not protect records against someone who takes and unlocks the phone. Say so. Day 1 scopes evidence to **photo, text, and audio** with a manual draggable blur and EXIF strip. **We do not blur faces in video** and do not claim to; the copy warns "We can't hide faces in video yet. Film carefully." Auto face-detection is later polish, gated on device capability.

---

### Starter design tokens

```css
:root {
  --sp-1:4px; --sp-2:8px; --sp-3:12px; --sp-4:16px; --sp-5:24px; --sp-6:32px; --sp-7:48px;
  --r-sm:8px; --r-md:12px; --r-lg:16px; --r-pill:999px;

  --font:"Noto Sans","Noto Sans Devanagari",system-ui,sans-serif;
  --text-xs:0.8125rem; --text-sm:0.9375rem; --text-base:1.0625rem; /* 17px */
  --text-lg:1.25rem; --text-xl:1.5rem; --text-2xl:1.875rem;
  --lh-tight:1.3; --lh-body:1.6; --fw-reg:400; --fw-semi:600;

  --motion-fast:120ms; --motion-base:200ms; --ease:ease-out;

  /* light */
  --bg:#F7F7F5; --surface:#FFFFFF; --border:#E2E2DD;
  --text:#1C1C1A; --text-muted:#5C5C57;
  --accent:#0F6E6E; --accent-text:#FFFFFF;
  --hazard:#B23A1E; --safe:#2E6B3E; --caution:#8A6A0F; --info:#5C5C57;
  --focus:#0F6E6E;
}
:root[data-theme="dark"] {
  --bg:#141414; --surface:#1F1F1E; --border:#34342F;
  --text:#EDEDE8; --text-muted:#A0A099;
  --accent:#3BA3A3; --accent-text:#0A2E2E;
  --hazard:#E8785A; --safe:#5FB878; --caution:#D6A93B; --info:#A0A099;
  --focus:#3BA3A3;
}
@media (prefers-reduced-motion: reduce) {
  * { transition-duration:0ms !important; animation:none !important; }
}
```

Theme follows the OS by default, with a manual override stamped as `data-theme` on `<html>` so the user's choice wins in both directions. This is the one token set. Re-run the AA contrast check once against it.

---

### Reachability audit (every feature, one home, ≤3 taps)

| # | Feature | Path | Taps |
|---|---|---|---|
| 1 | Rights / crisis cards | Stay safe → card | 1–2 |
| 2 | Official notices | Stay safe → Notices | 2 |
| 3 | Pseudonymous identity | Made silently on first post/record; backup in Settings | 0 extra |
| 4 | Record an incident | Record → New | 1–2 |
| 5 | Ground conditions | Nearby → Conditions | 1–2 |
| 6 | Area posts | Nearby → posts | 1–2 |
| 7 | Medical aid | Get help → A doctor | 2 |
| 8 | Mutual aid | Get help / Give help → food, water… | 2 |
| 9 | Assistance offers | Give help → medical/legal/skill | 2 |
| 10 | Accountability / legal tracking | Get help → Legal, or Record → send | 2 |
| 11 | Checking labels | Shown on every item; explainer in Settings | ambient |
| 12 | Access / offline | Global | ambient |
| 13 | Directory | Directory tab | 1 |
| 14 | Volunteer coordination | Give help → Add a resource, or Directory | 2 |
| 15 | Archive | Give help → More ways, or Record → send | 2 |

Nothing important is settings-only. Notices (2) live in Stay safe so a blackout user reaches them offline.

---

## 13. How this document is "done" (session hand-off)
This is the Session-1 deliverable. It is complete when the team agrees on:
- the domain feature set (§4), the safety/threat posture (§5–§7), the build scope + readiness gates (§8, §11), and the Will-Not-Build lines (§10);
- and has logged the open decisions (§12) for Session 2.

**Verification / review checklist before hand-off to architecture:**
- [ ] Every §4 feature has a safety note that survives the §5 threat model.
- [ ] The three red lines (§ Context) are accepted or explicitly renegotiated with counsel.
- [ ] §10 Will-Not-Build is signed off by whoever will operate the platform.
- [ ] §12 open decisions are assigned owners for Session 2.

**Next sessions:** (2) System architecture — map §4/§9 to a concrete Cloudflare + GitHub-Actions design, resolve §12 blockers, define data models/key management/transport. (3) Build.
