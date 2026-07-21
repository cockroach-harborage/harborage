# Harborage — System Architecture (Session 2)

**Status:** Architecture only. Session 1 (features PRD) is approved; Session 3 will build. This document consolidates the per-domain designs and **applies the adversarial security, Cloudflare-correctness, and buildability critiques**. Where a claimed safety property does not hold on this stack, it is stated plainly with the honest fallback.

**Governing principle:** safety-first against a resourceful hostile state-level adversary whose *dominant capability is metadata and traffic correlation*, not breaking content crypto. The architecture's job is to make compulsion **return nothing**, not to make it legal — and to be honest about the residual it cannot remove.

---

## 1. Architecture at a Glance

### 1.1 Locked decisions (Session 2 inputs)

| Decision | Locked value |
|---|---|
| Budget | Funded, $100+/mo. Workers Paid. Avoid gratuitous cost; keep protest-day graceful-degrade. |
| Client | **PWA-first**, offline-first installable SvelteKit PWA. Signed **Capacitor APK** = named later milestone for seizure-exposed users. |
| Frontend | SvelteKit + `@sveltejs/adapter-cloudflare` on **Workers Static Assets** (not Pages). Tiny bundles for low-end Android + 2G/3G. |
| Launch languages | English + Hindi; i18n architecture for all languages from day one; safety-critical strings human-reviewed. |

### 1.2 Two corrections the critiques force into the headline

1. **The owned Tor `.onion` is NOT the "primary" sensitive-write path on PWA v1.** A stock Android browser cannot open a `.onion` without Orbot/Tor Browser, and Tor itself is DPI-blockable. On v1, onion is a **minority/opt-in path**; the funded, explicitly-staffed onion origin + the bundled-transport APK is the milestone where source-IP protection becomes real. v1 must **say plainly that clearnet contact reveals app usage to the ISP (SNI) and Cloudflare (IP)**.
2. **"Near-zero-ops" is aspirational, not literal.** The design carries a permanent burden: offline key ceremonies, quarterly CF-token rotation, manual warrant-canary re-signing, manual D1 contract migrations, a human trust-&-safety org, and (later) an operated onion VPS. Scope is sequenced behind that reality (§12).

### 1.3 System topology

Three hard trust zones, one Cloudflare account, purpose-scoped Workers, a low-end-Android offline-first PWA. **All security-critical logic runs client-side** (key custody, HKDF derivation, E2E sealing, redaction, geo-fuzzing) so a swapped or compelled Worker sees only ciphertext, opaque tokens, and pre-fuzzed data — subject to the app-code TOFU limit (§9).

```
                          ┌─────────────────────────────────────────────┐
   PUBLIC (anon read)     │  SvelteKit PWA  (installed, offline-first)   │
   PSEUDONYMOUS (write)   │  • WebCrypto keys / HKDF tree / IndexedDB    │
   ── same app, client    │  • E2E seal • redaction • geo coarsen/jitter │
      decides trust ──►   │  • signed-pack verifier • encrypted outbox  │
                          └───────────────┬──────────────┬──────────────┘
                                          │ clearnet TLS │ (opt) Tor → owned .onion
                                          ▼              ▼
    ┌───────────────────────── Cloudflare edge (US-jurisdiction) ─────────────────────────┐
    │  Static Assets (free, unbilled)  │  WAF + coarse rate-limit  │  Transform Rules      │
    │                                                                                     │
    │  web Worker (SSR + shell)   api Worker (pseudonymous writes)   media Worker (presign)│
    │        │                          │  enqueue-and-return            │ mints short-TTL │
    │        │                          ▼                                ▼  multipart URLs │
    │        │                    ┌──────────┐   ┌──────────────┐   client ⇄ R2 direct    │
    │        │                    │ Queues   │──►│ consumer Wkr │   (bytes never proxy)    │
    │        │                    │ (+ DLQ)  │   │ Tier-0 detect│                          │
    │        │                    └──────────┘   │ (AI = later) │                          │
    │        ▼                                    └──────────────┘                          │
    │  Durable Objects (SQLite / memory-only per class):                                   │
    │   LiveBoard(ingest-shard+HLL / aggregator)  Broker/Mailbox  FlagState  NoticeLog     │
    │   RateLimit  Review-gate  Deadline-timer     (memory-only for timing/identity state) │
    │                                                                                      │
    │  D1 (unsharded v1, indexed)   R2 ×3 buckets   KV (config/flags)   Vectorize (later)  │
    └──────────────────────────────────────────────┬───────────────────────────────────────┘
                                                    │
   console Worker (PRIVILEGED) ── separate hostname, Cloudflare Access + passkey/HW-MFA
                                                    │
   Off-Cloudflare:  owned Tor v3 .onion origin (LATER milestone, neutral jurisdiction)
                    non-CF static mirror (IPFS / 2nd object store) of PUBLIC signed content
                    off-platform arms-length fetch box (source-media import)
                    lawyer-side custody (detainee identity, dossiers, evidence key-shares)
```

### 1.4 Trust boundaries

- **PUBLIC / anonymous read** — no account. Edge-cached signed, scrubbed, non-personal content (Directives, KYR, Official Notices, accountability public view, live-board snapshots). Served free from Static Assets and mirrorable off-CF.
- **PSEUDONYMOUS write** — on-device keypair (Ed25519/X25519), per-compartment capability certificate, proof-of-possession per request. No PII, no session table. Sensitive writes are **sealed client-side before submit**; the intake Worker structurally rejects any non-sealed body on a sensitive endpoint.
- **PRIVILEGED** — moderation, official-notice publishing, accountability review gate, kill-switch admin. Separate hostname, off the public app, behind **Cloudflare Access + phishing-resistant passkey/hardware MFA**. Access IdP identities are Cloudflare-side and compellable → staff-only, pseudonymous handles, minimized IdP linkage, treated as a compellable roster in the threat model.

---

## 2. Feature → Cloudflare Primitive Map

| # | Domain | Primary primitives | v1 posture / key constraint |
|---|---|---|---|
| 1 | Safety Directives & KYR | Signed `.harborage-pack` (Ed25519, off-edge key) in R2 + CDN + non-CF mirror; cache-first SW | **Ships first.** Verify-signature-then-serve; QR/file peer-share unit; zero sensitive data. |
| 2 | Official Notices | Ed25519 independent **m-of-n** packs; signed Key Directory + Revocation List; NoticeLog DO hash-chain; canary | Publish behind Access; revocation has a freshness floor (min-revocation-epoch). |
| 3 | Identity, Roles, Verification | WebCrypto Ed25519/X25519 (P-256 fallback) + IndexedDB; HKDF tree; stateless capability certs; Turnstile | No member directory; verifier map does not exist; reputation gated on blind-token upgrade. |
| 4 | Incident & Evidence | Client XChaCha20-Poly1305 → R2 (multipart presign); D1 incident; DO custody ledger; Shamir off-platform keys | **Manual solid-fill redaction is the guaranteed control**; ML is optional assist. |
| 5 | Live Ground Situation | Sharded ingest DOs + **HLL** distinct count → aggregator DO; memory-only; WS + rebuild-from-recent | Red line 3 params (§6). Coarse zone = single aggregator; ingest sharded. |
| 6 | Community Feed | D1 posts + verification labels; area-coarse/jittered geo; Tier-0 moderation | Follow areas/topics not people; reach earned by verification, not engagement. |
| 7 | Medical Aid | Broker DO (memory-only routing, jittered tick) + **sealed-box one-shot** (ratchet deferred) | **Onion-only** for medical broker; late location reveal in-envelope. |
| 8 | Mutual Aid | Broker DO 1:1; masked ephemeral relay | No home-address field, no amount/payment field ever. |
| 9 | Public Assistance Offers | D1 skills registry (non-browsable) + gated pull matching | Two-sided anti-honeypot; verify need before exposing helper. |
| 10 | Accountability & Legal | D1 public records (official-capacity only); Review-gate DO m-of-n; opaque case-refs; E2E case-doc vault; Deadline-timer DO | Off-platform dossiers/detainee identity; hard counsel gates. |
| 11 | Fact-Check / Moderation | Queues + DLQ; **Tier-0 detectors + community flag + reputation-gated reach** (Workers AI/Vectorize deferred) | AI never autonomous; Hindi safety-critical → human. |
| 12 | Access / i18n / Offline | Static Assets; hand-written SW; Paraglide i18n; self-hosted fonts; no-JS read path; DLT-partner SMS (outbound only) | Low-trust channels carry **only** public signed broadcast, never accept input. |
| 13 | OSS Governance & Ops | GitHub Actions (build/attest/deploy split); Sigstore SLSA; offline minisign; FlagState DO; Cron canary publish | No CF OIDC → contained long-lived token; canary signing stays manual. |

---

## 3. Component Architecture

### 3.1 Workers (purpose-scoped)

- **`web`** — SvelteKit SSR + Static Assets. `not_found_handling: "single-page-application"`; `run_worker_first` only on the few auth/logging routes so assets serve without spending CPU. 128 MB isolate is a hard ceiling — SSR stays tiny; **no image/video decode, no perceptual hashing here** (impossible in the Worker isolate). Route that work off-isolate: the **Images binding (`env.IMAGES`)** for resize/normalize/`.info()`, and **Cloudflare Containers** (up to 4 vCPU / 12 GiB, ffmpeg/OpenCV/pHash) for heavy image or any video work (see §14).
- **`api`** — pseudonymous writes. Verifies a compartment-scoped Ed25519 capability cert + per-request proof-of-possession. **Rejects any sensitive-endpoint body that is not a sealed envelope** (structural E2E enforcement). Rejects any two-compartment request (no server-side join key). Enqueue-and-return-fast; fan-out via Queue. (Update: the Workers 6-connection limit was **relaxed 2026-04-09** — it now caps only connections *awaiting response headers*, so bounded concurrent fetch / R2 streaming is fine and the old `Response closed due to connection limit` error is gone; see §14.)
- **`media`** — mints **multipart, per-part, short-TTL presigned R2 URLs** via `aws4fetch` (S3 API, not the account-wide REST path). Bytes never proxy through the Worker. Resumable across circuits/foregrounds so a 2G/onion upload that outlives one part-TTL survives (§7.1).
- **`console`** — privileged surface on a separate hostname behind Access + passkey/HW-MFA. Publishing, review gate, kill-switch admin, canary publish. Never end-user auth.
- **Queue consumer** — Tier-0 lexical/hash triage, notification fan-out, corroboration bookkeeping. **DLQ mandatory** or poison messages are silently discarded. Messages ≤128 KB (put blobs in R2, pass the key). Drain latency is real: sustained surge can make queued items minutes-to-hours late → a **dedicated high-priority intake queue with reserved concurrency for medical/detention** so life-safety items aren't stuck behind bulk feed moderation.

### 3.2 Durable Objects (collapsed to the minimum; sharding is a measured scale-up, not a v1 build item)

| DO class | Storage model | Why |
|---|---|---|
| **LiveBoard** (ingest-shard + aggregator) | **in-memory only** | Protestor signals must never hit DO SQLite (30-day PITR is compellable). Ingest shards keep HLL sketches; aggregator rolls up approximate distinct count. Rebuild-from-recent on eviction (§6.3). |
| **Broker / Mailbox** | **in-memory routing; ciphertext blobs to R2** | Handshake enqueue timings and inbox tokens are re-identifying — keep them out of SQLite so PITR captures nothing. |
| **RateLimit** | **in-memory** token buckets, salted-pubkey-hash keyed | Per-credential precise limits without a 30-day-recoverable who-submitted-when log. |
| **CIB window** | **in-memory**, Alarm-purged | Behavioral clustering must leave no persistent account-to-account graph. |
| **FlagState** | SQLite (append-only audit) | Non-personal config + heightened-threat flag; audit rows are staff-pseudonym only. |
| **NoticeLog** | SQLite | Low-write append-only hash chain + Merkle checkpoints; public by design. |
| **Review-gate** | SQLite behind Access | Naming state machine; reviewer role signatures; low volume. |
| **Deadline-timer** | SQLite (Alarm = 1 row write) | One DO with an alarm queue for DK Basu/Art.22 clocks; content-free payloads. |

> **CODEOWNERS-enforced invariant + CI check:** a test fails if LiveBoard/Broker/RateLimit/CIB state writes signal, location, timing, token→identity, or pubkey fields to DO SQLite or D1. This is the load-bearing rule; one "let's persist for reliability" refactor silently recreates a compellable log. **Resolved (verified 2026-07-22):** DO SQLite point-in-time recovery **cannot be disabled** and its 30-day window cannot be shortened, and since 2026-07-09 new namespaces are forced onto the SQLite backend — there is no PITR-free DO storage. This *validates* the memory-only design: the only mitigation is to never write this state to `ctx.storage`. (Confirm via Cloudflare compliance channel where legally load-bearing.)

### 3.3 Request flow (sensitive write, e.g. incident submit)

1. Client captures → hashes (SHA-256) → **manual solid-fill redaction + human before/after confirm** → seals unredacted original client-side (XChaCha20-Poly1305) → produces public redacted derivative.
2. Client writes both to the **encrypted local outbox** (IndexedDB, envelope-encrypted, max-age, panic-purgeable).
3. On next foreground (jittered), `media` mints multipart presigned URLs; client uploads ciphertext (vault bucket) + derivative (public bucket) **direct to R2**.
4. Client posts sealed incident metadata to `api`; `api` verifies cap-cert + PoP, confirms body is a sealed envelope, enqueues.
5. Consumer runs Tier-0 detectors, updates verification state (`Unverified` by default, never auto-amplified), links corroboration by **content similarity, never by submitter**.

---

## 4. Data Architecture, Classification & Retention

### 4.1 Four custody postures (enforced by physical bucket/DB separation, not policy)

| Class | Examples | Where | Survives compulsion? |
|---|---|---|---|
| **PUBLIC-PLAINTEXT** | Signed knowledge packs, official notices + hash-chain, scrubbed incident view, accountability public records (official-capacity only), facilities, redacted derivatives, coarse aggregates | D1 / R2 public + knowledge buckets, edge-cached | Safe to hold; signed by off-edge keys |
| **ENCRYPTED-AT-REST (defense-in-depth only)** | Minimal moderation/audit logs | D1/DO | **No** — CF could hold the key; treat as compellable |
| **CLIENT-SIDE E2E** | Evidence originals, brokered/medical/aid messages, case-doc vault | R2 vault bucket + Broker DO relays, ciphertext under opaque keys | **Yes** — CEK never sent to platform |
| **OFF-PLATFORM ONLY** | Detainee real identity, named-individual dossiers, donor data, evidence key-shares | Lawyer-side / offshore custodian | **Yes** — platform holds only opaque ref/hash/case-number |

### 4.2 Core D1 tables (high level; every filter column indexed — rows-read = rows-scanned)

- `incidents` — type, date, time-window, **coarse geohash-prefix + jurisdiction_bucket** (no lat/lng column), actor by role/unit/official-id, injuries/detentions, constrained narrative, verification_state, corroboration_count. *No* name/phone/precise-GPS/uploader→incident columns.
- `accountability_records` — badge/rank/unit/station, name_if_officially_established, documentary_anchor_hash, public_case_number, verification_state, inline m-of-n publication signatures. *No* home/family/private-life columns.
- `legal_matter_refs` — `{opaque_ref, jurisdiction_bucket, next_deadline_ts, public_case_number?, status}`. *No* party-name column.
- `notices` + `notice_chain` — signed notices + append-only hash chain.
- `key_directory` / `revocation_list` — signed, versioned, epoch-stamped.
- `reputation_scalars` — `{pubkey_hash, reputation_scalar, coarse_counters, epoch}`, per-compartment, no edges.
- `perceptual_hashes` — opaque pHash + canonical content-ID, **stored for Hamming lookup via BK-tree / banded LSH buckets, NOT in Vectorize** (Vectorize does cosine/euclidean/dot only).

**v1 D1 is a single unsharded database per logical DB** with disciplined indexing (CI schema-lint fails on any unindexed filter column). At launch volumes a well-indexed D1 is nowhere near the 10 GB cap; sharding is a pre-authored, metrics-triggered scale-up, not a launch task. Read-heavy public boards use **Cron-materialized rollup/aggregate tables** (not per-request scans) everywhere — the pattern Domain H already uses, applied to feed/incident public views too.

### 4.3 What must NOT exist (absence enforced at the schema layer)

- **No member directory / list-all-users.** Identities are high-entropy pubkeys with no account row and no enumeration endpoint. *Reconciliation:* the invariant reads **"no identity-bearing directory."** `reputation_scalars` is a PII-free, per-compartment, inactivity-expired pubkey list with no enumeration API — compliant under that wording, but it is still a compellable roster over the D1 Time-Travel window, so **any reputation-gated feature is switch-on-gated on blind-token/anonymous-credential-carried reputation** (server holds no list at all).
- **No social/follow/vouch graph.** Vouch/probation applies a revocable scalar delta; the causing edge is discarded. No edge/vertex table exists.
- **No who-was-where-when log.** No location/presence table anywhere. Live state is memory-only; incidents store only coarse geohash-prefix.
- **No identity↔pseudonym map.** Verified badges ride verify-then-forget / blind tokens off-platform.

### 4.4 R2 / KV / Vectorize layout

- **R2 (3 physically separate buckets):** `evidence-vault` (ciphertext only, **Bucket Locks** retention policy — *not* S3 Object Lock, which R2 does not implement; set via `wrangler r2 bucket lock add`; opaque ULID keys, no identity/location/time in key/prefix), `public-media` (redacted derivatives, R2-event→Queue moderation, CDN-cacheable), `knowledge` (immutable signed packs, edge-cached, peer-shareable). Free egress is decisive for cheap India media.
- **KV:** i18n bundles, feature-flag read cache, key-directory/revocation cache, Tier-0 rulesets. Read-mostly, ≤60 s propagation tolerated. **No sensitive identifiers in keys** (enumerable/compellable).
- **Vectorize:** deferred to post-launch (see §7.4). When enabled, semantic claim embeddings only — prefer `@cf/google/embeddinggemma-300m` (768-dim) or `@cf/qwen/qwen3-embedding-0.6b` (1024-dim) over the older bge-m3; the Vectorize index dimension is immutable, so fix it to the chosen model — opaque ID + coarse category/language metadata, treated as a **deanonymization surface** (nearest-neighbor leaks content and can re-link compartments by stylometry).

### 4.5 Retention machinery — and the honest limit

Auto-expiry via **Cron sweeps** (global housekeeping) + **DO Alarms** (precise per-object TTL) + short KV/token TTLs + minutes-scale presigned URLs. **Retention sweeps are NOT a compulsion defense.** D1 Time Travel (~30 days) and DO SQLite point-in-time recovery mean "we deleted it" is defeatable by a compelled Cloudflare restore within the window. Stated uniformly across the docs: **only E2E ciphertext, off-platform custody, or DO-memory-only state survives compulsion.** Every "ephemeral = safe on seizure" claim outside those three postures is qualified accordingly.

---

## 5. Cryptography & Key Management

**Library strategy:** audited `@noble`/`@scure` (curves, hashes, ciphers, bip39, base) in the first-load bundle — small, tree-shakeable, no WASM cold-start. **libsodium.js (WASM) lazy-loaded only behind the evidence vault.** No WASM on first paint (2G/old-Android budget). **All crypto lives in ONE tiny, audited, CODEOWNERS-frozen module**; a paid external crypto audit is a hard switch-on gate for evidence/brokered features.

### 5.1 Pseudonymous keypair + unlinkable derivation

- Account = **BIP39 mnemonic (English wordlist)** → seed → **HKDF-SHA-256 derivation tree**. `rootKey = HKDF-Extract(salt="harborage/v1", IKM=seed)`; per-compartment `seed_c = HKDF-Expand(rootKey, "compartment/"+domain+"/"+epoch, 32)` → Ed25519 (sign) + X25519 (ECDH). Per-request identity folds a nonce into `info`.
- Keys cached as **non-extractable `CryptoKey`** in IndexedDB (re-derivable from mnemonic). Fallback ladder: WebCrypto secure-curve → WebCrypto P-256 → `@noble` in-memory (reduced-trust, **read-only public path only**).
- **Server cannot link compartments at the key layer** (no join key exists; one compartment per session, enforced). **Honest reframe (critique):** this is unlinkability *at the key/transport layer only.* Content (stylometry, verbatim detail via the compellable embedding index) and shared IP/timing **re-link at the layer the adversary is strongest.** UX warns against reusing writing style/verbatim detail across compartments.

### 5.2 Recovery

BIP39 re-entry re-derives the whole tree. No server, no PII, no email/SMS reset — its **absence is the point** (no compellable backdoor). "Lose it = lose account," stated verbatim in-product. Optional SLIP-39 Shamir split of the mnemonic for distributed backup; optional BIP39 passphrase (25th word) selects a decoy tree — **best-effort only** in-browser (no hidden-volume guarantee; coercive unlock defeats it; don't oversell until APK).

### 5.3 E2E envelopes

| Interaction | v1 primitive | Note |
|---|---|---|
| One-shot brokered first contact (triage/need/offer drop, helper pull) | **libsodium `crypto_box_seal`** to published X25519 prekey (sender-anonymous) | **This is the v1 brokered-channel crypto.** Fits "late reveal." |
| Sustained ephemeral 1:1 | X3DH + Double Ratchet + sealed-sender | **DEFERRED post-audit.** Rolling a browser Double Ratchet by volunteers is the roll-your-own trap — v1 ships sealed-box only. |
| Small stable groups (case docs, n≈2–8) | Per-doc random CEK, **wrapped so recipient identity is not server-visible** (anonymous-recipient / trial-decryption), participant set held **off-platform** (lawyer-side) | Avoids materializing a case_ref→participant-pubkey collaboration graph (invariant). MLS deferred. |

**Prekey directory:** X3DH/sealed-box prekey bundles addressed by **opaque rotating handle** only (no list-all). **Prekey-fetch pairings are never persisted** and fetches ride the onion path where possible — otherwise the relay records a contact edge the invariants forbid.

**Relay is content-blind:** Broker/Mailbox DO sees only `{rotating inbox_token, ciphertext or R2 pointer, expiry}`, in-memory; pull-based content-free long-poll; jittered alarm-tick delivery (timing decorrelation). No who-pulled-what, no token→identity map, nothing to DO SQLite.

### 5.4 Evidence vault key custody (resolves Decision 6)

Random 256-bit CEK per file → XChaCha20-Poly1305 streaming AEAD (chunked) → ciphertext to R2. Platform holds **zero shares and exposes no unwrap endpoint** — making "we cannot produce plaintext" literally true and OSS-auditable.

- **Tier A (lower sensitivity):** CEK sealed to reporter vault key + one off-platform custodian.
- **Tier B (sealed/detainee-linked):** Shamir 2-of-3 over GF(256). **Critique fix — quorum topology, not just t/n:** no set of holders reachable within one jurisdiction may reach threshold. The **offshore custodian's share is MANDATORY in every quorum** (offshore + one of {reporter, lawyer}), or raise to a higher threshold with a majority offshore. Reconstruction on an **air-gapped offshore device.** This defeats platform compulsion and single-point seizure; it does **not** defeat rubber-hose on a coerced human. Counsel sets the split.

### 5.5 Official signing, m-of-n, revocation, root-of-trust (resolves Decision 12)

- **Role-bound Ed25519 keys**, generated air-gapped in a documented multi-person ceremony on hardware tokens; never touch Cloudflare or CI. High-stakes directives carry **independent m-of-n multisig** (e.g. ≥3-of-5), each signer offline (FROST deferred). Client verifies all m signatures against the pinned directory + the directive-type policy.
- **Signed Key Directory + Revocation List** shipped inside the offline pack; client checks signer∈directory, signer∉revocation, notice epoch ≥ key validity, and **min-revocation-epoch** to detect stale-list rollback. **Freshness floor is real:** a long-offline client can honor a revoked (e.g. seized-marshal) key until it sees a newer epoch — mitigated by short epoch cadence, signed heartbeats in every pack, and **propagating revocation through peer QR/file packs** so it reaches offline clients out-of-band.
- **Root-of-trust bootstrap:** root pubkey pinned in app shell + APK; fingerprints distributed redundantly out-of-band (printed cards at known-safe orgs, multi-mirror, transparency-log anchoring, peer QR trust packs). **Cannot guarantee** first-contact over a fully hostile network — redundancy + physical distribution is the strongest link. Counsel + field partners own the distribution plan.

### 5.6 Content / release signing

Two layers (trimmed to the operable 80%): **(1) CI supply-chain** — Sigstore cosign keyless (GitHub OIDC) + Rekor + SLSA provenance, no long-lived CI key. **(2) User-facing root** — **minisign** detached signatures over release artifacts + offline knowledge packs, signed by the offline m-of-n project key, verified in-app against the pinned pubkey. SW bakes in the pubkey and refuses assets not matching the signed `{path:sha256}` manifest + SRI. *Deferred to post-v1 stretch (research-grade, won't be operated correctly by volunteers at launch):* client-side gossiped Merkle equivocation detection and bit-for-bit reproducible-JS. Ship a public "verify-what-the-edge-served" watcher as **detection of broad tampering** — never prevention of a targeted hit.

### 5.7 Verifier-honeypot (resolves Decision 5)

Ship **org-vouch "verify-then-forget"** at launch: an off-platform verifier (separate jurisdiction) checks the bar-council/medical registration and issues a revocable, per-compartment badge **bound only to the pseudonymous pubkey**; any transient identity mapping lives solely off-platform, minimized and destroyed at issuance. **No identity↔pseudonym table exists anywhere on Harborage.** First upgrade: **Privacy Pass / blind tokens (RFC 9576/9578)** for unlinkable redemption. BBS+ deferred to native-app era (WASM pairing-crypto weight). Irreducible: issuance sees the real professional — the guarantee that the binding never lands on-platform is a **policy + architecture** guarantee, counsel + crypto reviewer approve.

---

## 6. Realtime Live Board (red line 3)

### 6.1 Two physically separated layers

1. **Protestor-signal board** — ephemeral hazard/condition signals. **Memory-only.**
2. **Facilities layer** — public infrastructure (toilets/water/charging/aid/rest), precise coordinates allowed, persistent in a **separate** FacilitiesDO/D1, edge-cacheable. Deliberately segregated so precise facility locations can never be joined to protestor density.

### 6.2 DO topology (critique-corrected)

The coarse-zone red line forces the largest protest onto **one geohash-6 aggregator**. A single single-threaded DO cannot do all ingest + exact distinct-reporter counting at peak, and Broadcast sub-DOs only fan out *viewers*, not ingest. Therefore:

- **N sharded ingest DOs per hot zone**, each maintaining a **HyperLogLog sketch** over per-(zone,epoch) HMAC dedup tokens.
- **One aggregator DO** rolls up the HLL sketches into an **approximate** distinct count → density floor + crowd band. Approximate counting is tolerable and arguably safer (output is already coarse bands + a floor).
- **WebSocket Hibernation** for idle viewer sockets — but the board is explicitly **rebuild-from-recent-reports**: a hibernation eviction wipes in-memory state, which reconstructs within one publication tick from a short rolling replay. We do **not** claim both cheap-hibernation *and* durable in-memory state (they contradict). Broadcast sub-DOs are a **measured scale-up**, not a v1 build item.

### 6.3 Ingest & dedup

Ingest Worker validates against a schema with **no lat/lng field** (enumerated fixed-grid zone id only); rejects any coordinate-bearing payload; scrubs `CF-Connecting-IP`/geo before emit. `dedup_token = HMAC(in-memory per-(zone,epoch) salt, reporter_session)`; salt never persisted, rotates ~15 min, zone folded in → tokens unlinkable across epochs and zones. **Marshal quorum:** SAFE_EXIT / DISPERSAL publish only with **≥2 valid role-bound marshal Ed25519 signatures** (in-directory, not-revoked); community versions without quorum are withheld, not shown low-confidence.

### 6.4 Safety parameters (starting proposal — Decision 11; requires adversary-modeling + counsel sign-off before switch-on)

| Parameter | Proposed value |
|---|---|
| Publication zone | geohash-6 (~1.2 km × 0.6 km), never finer |
| Density floor D (suppress-until-safe-density) | ≥ 5 distinct reporters before any signal shows |
| Corroboration K | ≥ 3 distinct reporters to publish a hazard as Corroborating; single report withheld |
| Crowd bands | {none, small, moderate, large, very large}, wide hysteresis, no counts; disabled entirely in heightened-threat |
| Publication delay | base 60 s + random 0–120 s jitter (60–180 s effective lag) |
| Signal TTL | ~10 min; dedup-salt epoch ~15 min |
| SAFE_EXIT / DISPERSAL | 2 independent marshal signatures + recent-epoch assertion |

### 6.5 Fail posture split (critique fix)

Privacy-sensitive **writes and location tagging fail closed (off)** if FlagState is unreachable — but **safety-critical hazard/SAFE_EXIT reads fail to last-cached-with-STALE-badge, never fully dark.** An adversary who DoS-partitions the FlagState DO must not be able to blind users to TEAR_GAS/KETTLING/SAFE_EXIT. The flag read path degrades to a locally cached last-known flag state for read surfaces.

---

## 7. Evidence & Moderation Pipelines

### 7.1 Capture → redact → vault

`capture → SHA-256 + minimal Ed25519 provenance (ProofMode-style, deliberately minimized sensor metadata) → redaction → two separated outputs.` **Manual solid-fill redaction (user drags boxes over faces/plates on a canvas) + mandatory human before/after confirm is the guaranteed, always-available control** — zero ML download, works on 2G. On-device face/plate ML is an **optional, capability-gated, lazy-loaded assist**, never on first paint, never a safety guarantee (it misses on exactly the low-end devices high-risk users carry). Redaction uncertainty **fails closed to vault-only.** The public redacted derivative is the **only** server-readable output; the unredacted original is sealed client-side and never server-readable.

**Uploads:** R2 **multipart with per-part short-TTL presigned URLs**, client-side resumable chunking, part URLs re-minted on demand. This reconciles the two locked constraints that otherwise collide — "minutes-short expiry for seizure safety" vs "multi-MB evidence over 2G/onion" — a single long-lived URL would expire mid-upload.

### 7.2 Custody ledger + §63 BSA export

Append-only hash chain in a DO (`H_i = SHA256(H_{i-1} ‖ payloadHash_i)`) records capture/redaction/upload/review/unredacted-access; periodic signed Merkle checkpoints. The **§63(4) certificate export** (dual signature: person-in-charge + expert, hash disclosed) is assembled by the platform but **signed off-platform by humans**. **Preservation, NOT admissibility** — never over-promised; counsel + qualified expert approve the certificate form.

### 7.3 Source-media import (resolves Decision 14)

> **Updated by §16 (Session 2.5):** source media is now **fingerprint-AND-preserve**, not fingerprint-only. Imported evidence is deduped by `original_sha256`, a redacted optimized derivative is admitted to the public Evidence Archive, and one pristine original is sealed in the vault. Copyright / IT-Act §79 posture and the counsel gate before any irreversible step (Bucket Lock / replication) are in §16.

**Fingerprint-and-reference, never re-host by default** (copyright / IT-Act conduit exposure). Store canonical content-ID + perceptual hash; any evidentiary copy goes to the sealed vault only. **Perceptual hashing cannot run in a Worker** (no image/video decode, 128 MB, CPU limits) — so:
- Fingerprints for imported links are computed on the **off-platform arms-length fetch box** (the same egress Decision 14 needs), which fetches over Tor, pooled/deduped by content-ID, **no per-user fetch log.**
- **Low-popularity URLs get a deliberate delay + minimum-cohort threshold** before fetch (or skip fetch and store only the user-supplied content-ID/pHash) — dedup only anonymizes *popular* content; an obscure single-referrer URL is otherwise ~1:1 time-correlated to the submitter.
- pHash near-dup matching lives in a **BK-tree / banded LSH** structure (Hamming distance), **not Vectorize.**

### 7.4 AI-assisted human-in-the-loop moderation

> **SUPERSEDED by §15 (Session 2.5) — AI verification is now DAY-1 CORE, not deferred.** Because Harborage serves an *ongoing* protest with real use before human moderators exist, the AI + community + reputation layer is the day-1 core. It runs autonomously on **reversible** actions only (label, rank, hide-pending, retain-pending), honestly labeled "not human-verified," with a low capped ceiling. It is **never** autonomous on irreversible high-harm actions (individual naming, unredaction, precise-location reveal, permanent deletion) — those stay m-of-n human-gated and ship OFF. The material below is retained for its Tier-0 floor, spend-cap, and degrade-ladder detail (which §15 builds on); where it reads "AI is deferred," §15 governs.

**v1 = Tier-0 only.** Free lexical/dictionary detectors (PII/doxxing regex, incitement lexicon "confront/find/retaliate", known-bad pHash lookup, EN/HI language routing) + community flagging + **reputation-gated reach** (unverified never amplified) + human review. This is the always-on safety floor that runs even at zero AI budget.

**Workers AI (`@cf/meta/llama-guard-3-8b`, native Hindi) + embeddings (`embeddinggemma-300m` / `qwen3-embedding-0.6b`) + Vectorize are DEFERRED** past launch (buildability + Hindi-is-advisory-only make them marginal for an en/hi launch and add spend-cap/index/poison-message ops surface). When enabled, prefer routing model traffic through **AI Gateway Guardrails** (GA; provider-agnostic Llama-Guard moderation + PII DLP + analytics, Hindi supported) rather than hand-rolling guard calls. When enabled later:
- Cheap-classifier-first, behind Turnstile + rate-limits + **spend caps** (spend-cap DO, strongly consistent daily Neuron counter; KV kill-switch degrades to queue-and-defer / human-only at the cap).
- **AI only flags / down-ranks / narrow-quarantines — never autonomous delete/publish, never touches E2E/private content** (Cloudflare sees plaintext sent to Workers AI, so only public-tier content is ever sent).
- **AI-capped is a first-class sustained operating mode**, not an emergency: a national protest day is an order of magnitude above the "100k items/day" estimate and *will* hit caps; Tier-0 + reputation-gated reach must carry safety alone, with a defined human-throughput assumption.
- Hindi/other-language safety-critical verdicts are **advisory only → human review** (matches locked i18n decision).

**Anti-incitement / anti-doxxing tripwire:** on a violence-intent or **private-individual PII** hit → immediate quarantine → brief human-confirm hold → **short-purge the payload** (retaining violence-intent + PII is UAPA/BNS-radioactive), keeping only a minimal non-content audit row `{opaque_id, category_code, action, ts, model_version, reviewer_ref}`. Radioactive payloads **cannot be retained-during-appeal** (gone by design) — appeals run off the audit record. The tripwire targets **private-individual** data only; **official-capacity accountability naming is out of scope** and routes to Domain-10's separate m-of-n gate, so the classifier cannot be weaponized to suppress legitimate misconduct records. Coordinated mass-flagging is itself a CIB input → trips into human review, not auto-suppression.

---

## 8. Accountability & Legal Boundary (red lines 1 & 2)

### 8.1 On/off-platform split

> **Refined by §15 (Session 2.5):** autonomous institutional-pattern accountability aggregates **only to non-individually-resolvable granularity (station / unit / rank-band / shift)**. Any single-person-resolvable identifier — **badge number**, name, specific plate — is treated as *individual* naming, not institutional, and is routed to the §8.2 human-gated Review-gate, which ships OFF until reviewers exist.

| Data | Custody |
|---|---|
| Official-capacity misconduct identifiers (badge/rank/unit/station, officially-established name) — post-gate | **On-platform public** (D1) |
| Institutional patterns (counts by unit/station/rank, complaint/FIR/NHRC status) | On-platform public, **primary surface** |
| Named-individual dossier, most-identifying evidence | **Off-platform** (lawyer-side); platform holds hashes/coarse role/case-ref |
| Detainee real identity, family, Art.22/DK-Basu detail | **Off-platform only**; platform holds `{opaque_ref, jurisdiction_bucket, next_deadline_ts, public_case_number?, status}` |
| Case documents (n≈2–8) | **E2E ciphertext** in R2, keys off-platform, recipient identity not server-visible |

### 8.2 Naming review gate (resolves Decision 4)

Publishing any individual identity is a **Review-gate DO state machine**, default **WITHHELD**, transitioning to PUBLISHED only when **all** hold: (1) official-capacity fields only; (2) verification_state = Verified; (3) corroboration ≥ N; (4) **≥2-of-≥3 distinct reviewer role-key Ed25519 signatures** over the identical canonical record hash; (5) documentary anchor present; (6) no-call-to-action classifier pass; (7) right-of-reply channel. The publish Worker **re-verifies the m-of-n bundle against the pinned key directory before any public D1 write** — a compromised/compelled Worker cannot fabricate a published name without the client-held quorum keys. **Removal is single-reviewer-capable (fail toward removal); publication is quorum-required (fail toward not-publishing).** Counsel sets N, the official-capacity line, and the right-of-reply SLA.

**Red line 2** ("posing as police" private individuals): a distinct, stricter **default-DENY** path — the identity is **not stored pending review**, only the claim + evidence hash; withheld unless a higher corroborated, human-reviewed bar is met.

### 8.3 Detainee tracking (resolves Decision 7)

Content-free per-matter **Deadline-timer DO alarm** fires "deadline approaching for ref X"; lawyer device polls by ref token **over onion**, decorrelated, so the server sees only opaque-token polls, never the lawyer's full portfolio at once, never a source IP. **Incommunicado alert** fires only on **two independent authenticated triggers + human broker confirm**, rate-limited, content-free payload — abuse-resistant against agent-provocateur false alarms. Counsel defines the opaque-ref scheme, the incommunicado trigger, and whether any detainee field may transit the platform even transiently (hard gate).

---

## 9. Security, Privacy & Censorship-Resistance

### 9.1 Metadata posture

Cloudflare is **semi-trusted for availability, untrusted for metadata confidentiality** — it terminates TLS, sees every source IP, and is US-jurisdiction compellable. **Metadata-store concentration is the SPOF, not just content:** one US legal process to the single CF account reaches D1 (incl. the pubkey/activity roster), the embedding index (content-reconstructable when enabled), DO PITR state, KV, and the deploy-token path at once. Roadmap: move the most compellable metadata (any pubkey roster, the notification/broker routing plane, the embedding index) toward off-CF or split-jurisdiction hosting; make the **offshore legal entity a hard gate on who holds the account.** Near-term: minimize what each store holds and **document that a single CF compulsion yields the full metadata set.**

### 9.2 Tor/.onion (resolves Decision 9 — honestly)

An **owned Tor v3 `.onion` origin off Cloudflare** is the only configuration that removes the source IP from CF's and the ISP's view. **But (critique):** a stock PWA browser cannot reach `.onion` without Orbot/Tor Browser, and Tor itself is DPI-blockable (circumventing needs bridges/pluggable transports only Tor Browser/Orbot can use — not a plain PWA). CF Onion Routing (`opportunistic_onion`) needs the clearnet domain reachable first — **not** a circumvention tool. Therefore:
- **v1:** onion is a minority/opt-in path. The realistic baseline is Tor-Browser/VPN → clearnet CF domain + encrypted outbox with decorrelated foreground-flush. **State plainly that v1 IP-correlation resistance is weaker.**
- **Life-safety flows (medical broker, detention handshake): onion-only, refuse over clearnet** — in a low-volume broker, two IPs hitting the same DO within the jitter window is a strong requester↔responder pairing sealed-sender does not hide.
- The operated onion origin + the **Capacitor APK bundling Orbot/Arti** is the milestone where onion becomes real for the general user and a prerequisite for switching on the highest-risk flows. The VPS **posts to an authenticated Worker ingest endpoint** (there is no "tunnel into a Queue" primitive) and is honestly a new compellable party + ops burden + its own SPOF — hence a funded, explicitly-staffed milestone, not v1 core.

### 9.3 Timing decorrelation

Encrypted outbox dispatches **decorrelated from authoring** (foreground-flush + jitter — framed as a safety feature: "sends when you next open the app, from a fresh circuit"). Broker DOs mediate handshakes on a **fixed jittered alarm tick**. **Honest limit:** no constant-rate cover traffic is feasible on 2G/battery — decorrelation is *meaningful, not information-theoretic*, surfaced on medical/detention flows.

### 9.4 Notifications (resolves Decision 8 — critique-corrected)

- **Default: content-free poll-on-open + foreground long-poll/WebSocket during active sessions.** No third-party push for anything sensitive.
- **Drop the "constant-cadence background poll" framing.** Background execution is impossible on iOS PWAs and Chromium-only via Background Sync — it mostly won't run and costs 2G users battery/data. **More importantly, periodic clearnet contact with the app domain is itself the membership/presence leak** (SNI to ISP, IP to CF); content-free payloads do nothing about the connection. Prefer long-lived foreground sockets, large randomized gaps, and route the notification channel over onion where the client can. Consider a neutral/co-hosted domain to blunt SNI attribution.
- **Web Push (FCM/APNs) is DROPPED from v1.** Even payload-free, the subscription set is a compellable, device-identity-linked user roster held by Google/Apple — in tension with the no-device-identity and no-member-directory invariants, for marginal value. If ever revived, APK-only with a high-visibility warning.
- **Timely background alerts genuinely require the APK** — say so on medical/detention surfaces.

### 9.5 App-code integrity — the true root of trust (de-marketed per critique)

On the web, Cloudflare delivers the JS per request; a compelled/compromised edge can serve **poisoned JS to one targeted user** that exfiltrates the mnemonic/CEK or the unredacted frame *before* sealing — undetectably from inside the page. Therefore **every client-side-crypto guarantee is conditional**: "platform cannot read," "irreversible redaction," "no precise GPS leaves the device," "keys never touch the platform" all hold **in bulk / absent a targeted code-injection order**, and are said that way on high-risk surfaces. SW-pinning converts "poison every request" into "poison must survive an SW update" (louder, rarer); reproducible-build + the edge-watcher give **broad-tamper detection, not targeted-hit prevention.** The **OS-signature-verified Capacitor APK is the only real fix** → the highest-risk data-holding flows (evidence-vault capture, detainee/incommunicado, accountability naming by reviewers) are **gated to the APK for the highest-risk tier**, and reviewers/lawyers use the APK client.

### 9.6 Low-trust-channel boundary (structural)

SMS/USSD/IVR/no-JS routes can **only read cached signed public content** — there is **no code path** from them to any write/intake endpoint. **The critique's most important fix: there is NO "non-JS fallback that accepts a sensitive write."** If Turnstile hard-fails on a JS-capable client, degrade to an alternative JS challenge / proof-of-work / blind-token check **while still sealing client-side before submit.** If the client cannot run crypto at all (old WebView), the sensitive write is **refused** with a prompt to use a capable client/the APK — it must never enter a Worker as plaintext. The intake Worker **structurally rejects any sensitive-endpoint body that is not a sealed envelope.** SMS is outbound public digest only, via a DLT-registered Indian partner org, region-gated (J&K VPN-criminalization means risky-channel guidance is a per-region counsel decision, never a global default).

### 9.7 What this architecture CANNOT protect against (honest-limits page)

1. **App use is observable.** ISP + Cloudflare see *that* you connected and often *from where*. Onion mitigates sensitive writes only; general clearnet browsing is exposed. "We don't log IPs" is a promise about *our* retention — **safeLog scrubs only our app logs, not Cloudflare's platform telemetry/analytics/billing**, which capture IP/SNI/colo/timing independently and are compellable. Only onion removes the IP from CF's own view.
2. **Targeted per-request client poisoning on the web is undetectable from inside the page.** Only the signed APK fixes code at install.
3. **Browser key custody, panic-wipe, and decoy accounts are best-effort** until the APK; a seized+unlocked device is compromised (IndexedDB is not encrypted at rest; non-extractable ≠ hardware-backed).
4. **Cloudflare, the onion VPS operator, any Indian SMS partner, and any human key/share-holder are legally compellable** (US + India reach). The architecture minimizes what they hold; it cannot make them non-compellable. Rubber-hose on a coerced human defeats threshold crypto.
5. **Traffic-analysis resistance is partial** — no constant-rate cover traffic on 2G/battery.
6. **A nationwide Cloudflare block is a total availability SPOF** for the online stack — mitigated (offline PWA, non-CF public mirror, later onion/mesh) but not eliminated in v1.
7. **Compartment unlinkability is key/transport-layer only** — content/stylometry/timing can re-link.
8. **Out-of-band trust bootstrap over a fully hostile network is unsolved** — redundancy + physical distribution reduce, not eliminate, first-contact MITM.

---

## 10. CI/CD, Ops, Kill-Switches & Governance

### 10.1 Pipeline (build / attest / deploy separation)

- **build** — untrusted-input phase on PR + main; deps, lint, typecheck, tests, SvelteKit build, SBOM. **No Cloudflare creds, no `id-token`, no secrets.** Runs the **fully-offline cold-boot Playwright gate** (`context.setOffline(true)`: read Directives/KYR, verify a cached Official Notice, draft an incident, view last snapshot with STALE badge — any network touch fails the build). Pre-flights every D1 migration against ephemeral SQLite.
- **attest** — Sigstore keyless SLSA provenance (`actions/attest-build-provenance`); `id-token: write` lives *only* here.
- **deploy** — GitHub Environment-gated (`staging` auto; `production` = ≥2 required reviewers + wait timer + branch locked to main). `wrangler deploy --no-bundle` ships the exact attested bytes. **Only this job holds the scoped, long-lived `CLOUDFLARE_API_TOKEN`** (no CF OIDC exists — Discussion #11434 / wrangler-action #402 open). Token is **contained, not eliminated**: min scope (`Workers Scripts:Edit, D1:Edit, KV:Edit, R2:Edit, Secrets Store:Edit`), per-environment, GitHub Environment secret, quarterly manual rotation, CF audit logs on. Say this plainly — do not claim "no long-lived secrets."

### 10.2 D1 migrations

Forward-only (no `wrangler d1 migrations rollback`): **expand → deploy code → contract**, each a separate reviewed PR. Every migration ships a **pre-authored inverse** in `migrations/inverse/`. The destructive contract step is a **manual human promotion** after new code is verified live. `PRAGMA defer_foreign_keys` on FK reshapes. Time Travel (~30 d) is break-glass only.

### 10.3 Kill switches + heightened-threat mode

**FlagState DO** (SQLite, strongly consistent, append-only who/when/why audit) is source of truth. Read path = short-TTL (5–10 s) KV/Cache with **per-colo in-isolate caching** so the DO is hit at most once per TTL per colo (never per request — it is single-threaded). **Correction (critique):** there is **no "DO-pushed cross-colo cache purge" primitive** — the real propagation bound is **the TTL, per colo.** State flip latency honestly as "up to the TTL." Fail posture is **split** (§6.5): sensitive writes/location fail closed; safety-critical reads fail to last-cached. **HEIGHTENED-THREAT** is one composite flip (disable low-trust channels + Web-Push-if-ever + accountability publication, tighten intake, raise moderation strictness, shorten retention, force onion-only sends). Irreversible flips + accountability-publication/detainee-intake toggles require **2-person authorization**.

### 10.4 Warrant canary

Cron **publishes** a human-produced, **offline-minisign-signed** canary to `/.well-known/canary.txt` + transparency log with a hard expiry. **Signing stays manual/offline by design** — automating the sign would let a compelled Cloudflare keep the canary alive (a security bug). Missing/expired signature *is* the signal; clients verify freshness against the pinned pubkey and shift to protective posture. Needs a documented signer-succession/coercion plan. The operator roster (Access identities) is in-scope for the canary.

### 10.5 Safe observability

`safeLog()` is the **only** logging path (lint bans raw `console.*`; CI asserts sensitive field names never appear at call sites). Log route templates, status class, coarse timing, flag state — **never IP, geo/location, identifiers, tokens, bodies, full URLs.** `CF-Connecting-IP` scrubbed at ingress via Transform Rules. Head-based sampling for protest-day volume. Minimum retention. A sensitive field reaching logs is a Sev-1. **Honest scope:** this governs *our* retention only — CF platform telemetry is compellable regardless (§9.7).

### 10.6 Supply-chain + contribution hardening

Every action pinned to a full 40-char SHA (zizmor/ratchet enforce); **CODEOWNERS + ≥2 reviewers** on `workers/**` (esp. auth/crypto/location/evidence), `migrations/**`, `.github/workflows/**`, `infra/**wrangler*`, and all signing/canary code + the frozen crypto module + the DO memory-only invariant classes; secret scanning + push protection + gitleaks; `step-security/harden-runner` egress control; default `GITHUB_TOKEN` `permissions: {}`; branch protection on main (linear history, required checks, signed commits, no force-push, admins included); Dependabot/Renovate through the same 2-reviewer gate. Infra secrets in Cloudflare Secrets Store (Beta — keep per-Worker `wrangler secret put` as GA fallback); **content/evidence keys are never server-side.**

### 10.7 Must-stay-manual (by design)

1. Warrant-canary re-signing (offline key, every period).
2. Release/canary/APK signing-key generation, custody, rotation (offline hardware token, m-of-n ceremony, never in CI/CF).
3. Production deploy approval (≥2 reviewers).
4. Cloudflare deploy-token rotation (quarterly — no OIDC to shorten it).
5. Destructive `contract` migration promotion.
6. D1 Time-Travel restore (break-glass).
7. Enabling irreversible / heightened-threat / accountability-publication / detainee-intake flips (2-person).
8. Sensitive-path CODEOWNERS membership changes.

---

## 11. Resolved Open Decisions

| # | Decision | Resolution | Counsel still required? |
|---|---|---|---|
| 1 | PWA vs native | **PWA-first** (SvelteKit / Workers Static Assets); **Capacitor** (not bare TWA) signed APK on F-Droid/direct/peer-pack as named later milestone for seizure-exposed users | No (product/eng); disclose web integrity limit in-product |
| 2 | Legal entity & jurisdiction | **Split/layered (Option 4):** offshore foundation holds CF account + signs releases (ciphertext + public only); offshore fiscal host holds money; OSS collective for contributors; lawyer-side off-platform custodians | **YES — hard gate; blocks every data-holding feature** |
| 3 | "Peaceful" vs "lawful" line | Policy-configurable: counsel-set charter + KV ruleset + kill switch; tripwire fails to quarantine-then-short-purge for violence-intent — never hard-coded | **YES — counsel sets the line** |
| 4 | Accountability naming bar | 7-part bar as Review-gate DO state machine + m-of-n publication signature re-verified by publish Worker; institutional-first, individual naming default-WITHHELD | **YES — sets N, official-capacity line, defamation/UAPA posture, RoR SLA** |
| 5 | Verifier honeypot | Org-vouch "verify-then-forget" at launch → blind tokens (Privacy Pass) first upgrade → BBS+ native-era; **no identity↔pseudonym map on-platform** | **YES — scheme, jurisdiction, minimize-and-destroy policy + crypto reviewer** |
| 6 | Evidence-vault key custody | Client XChaCha20-Poly1305; Tier A dual-seal; Tier B **Shamir with mandatory-offshore-share quorum topology**, air-gapped offshore reconstruction; platform holds zero shares, no unwrap endpoint | **YES — t/n, custodian jurisdictions, custody topology** |
| 7 | Detainee data & incommunicado | Platform holds `{opaque_ref, jurisdiction_bucket, next_deadline_ts, public_case_number?, status}` only; real identity off-platform; content-free DO-alarm poll over onion; two-trigger + human-broker incommunicado | **YES — hard gate; opaque-ref scheme + trigger definition** |
| 8 | Notification path | **Content-free poll-on-open + foreground long-poll/WebSocket**; no third-party push for sensitive; **Web Push dropped from v1**; timely background alerts = APK-era | Threat-model confirm only (no counsel gate) |
| 9 | Tor/.onion sensitive-write path | Owned onion = **funded later milestone**, onion-only for life-safety flows; **NOT "primary" on PWA v1** (needs Orbot + Tor DPI-reachable); APK bundles transports | Counsel/ops on onion VPS jurisdiction (ties to #2) |
| 10 | Shutdown SMS/IVR/USSD | **Outbound public signed broadcast only, never accepts input**, via DLT-registered Indian **partner** (not core entity), region-gated; mesh = native-only later | **YES — partner jurisdiction + J&K region-gating** |
| 11 | Live-view parameters | Starting proposal in §6.4; structural side resolved (no location table, memory-only, jitter-before-write) | **YES — numeric params need adversary-modeling + sign-off; blocks Domain 5** |
| 12 | Root-of-trust bootstrap | Offline m-of-n key ceremony on hardware tokens; root pinned in shell + APK; redundant out-of-band fingerprint distribution; offline-honored Key Directory + Revocation List | **YES — first-key anointing ceremony + physical distribution plan** |
| 13 | Moderation staffing | Small compartmentalized pseudonymous pool behind Access + HW-MFA, least-privilege RBAC, reviewer-protection, m-of-n for high-stakes; Tier-0 + reputation-gated reach cut human load; **"human org exists" is a switch-on interlock** | **PARTIAL — sourcing, jurisdiction, coercion/succession** |
| 14 | Source-media import | Fingerprint-and-reference (no re-host); fetch on **off-platform Tor egress box** (not a Worker), pooled/deduped by content-ID, delay+cohort threshold for low-popularity URLs, no per-user fetch log | **YES — ToS/copyright posture** |

---

## 12. Build Order for Session 3

All domains are *architected*; they are **not all built for v1**. A volunteer team ships a coherent core sequenced behind the legal/organizational critical path. **Each data-holding milestone is gated on BOTH its counsel interlock AND the existence of the human org that operates it.**

> **Updated (Session 2.5):** the **autonomous AI + community trust engine is M1 day-1 core** (§15), not deferred — the human moderation org is a **hardening** milestone (A0→A3), not a launch prerequisite, for the reversible surface; only the irreversible m-of-n gates (individual naming, unredaction, precise-reveal, permanent delete) stay human-gated and ship OFF. The **public Resource Directory** (seed pack + zero-account offline browse) is **M1** (see PRD §14); the **Community Feed** is **M3**; the **Evidence Archive** reversible parts (dedup / transcode / data model / display) are **M3**, with Bucket Locks + off-CF replication + IPFS counsel-gated (§16). New day-1 components: `VerificationStateDO`, `SpendCapDO`, `CoordinationWindowDO` (ephemeral CIB, no persisted graph), `ReReviewQueueDO`, `FLAGS` KV, `resource_entries` D1 table. IaC + minimal manual surface per §17 + [RUNBOOK.md](./RUNBOOK.md).

| Milestone | Scope | Launch-readiness gate |
|---|---|---|
| **M0 — Foundations & integrity** (human/legal, blocks all) | Offshore entity + CF account holder (#2); offline m-of-n key ceremony + out-of-band fingerprint plan (#12); frozen audited crypto module + paid crypto audit booked; CI hardening (SHAs, CODEOWNERS, offline cold-boot gate, safeLog, memory-only invariant tests); FlagState DO + heightened-threat | Entity exists; keys ceremony done; crypto audit scheduled; CI gates green |
| **M1 — Signed knowledge + notices** | PWA shell + offline SW + signed-pack verifier + Domain 1 (Directives/KYR) + Domain 12 (i18n en/hi human-reviewed, self-hosted fonts, no-JS read path); Domain 2 Official Notices + warrant canary; non-CF public mirror + peer QR packs | Zero sensitive data; signed-pack verification + canary live; #12 distribution partners in place |
| **M2 — Identity + moderation floor** | Domain 3 identity core (HKDF tree, stateless cap certs, Turnstile-with-refuse-not-plaintext-fallback); reputation scalar (behind blind-token gate before any reputation-gated reach); Tier-0 detectors + community flag + reputation-gated reach; moderator console behind Access | Crypto audit passed; #5 verifier scheme signed off; moderation human org staffed |
| **M3 — Evidence** | Domain 4 capture → manual solid-fill redaction → E2E vault (sealed-box + Shamir off-platform); multipart resumable presign; custody ledger + §63 export; source-import fingerprint-and-reference on off-platform egress | #6 key custody + #14 ToS signed off; APK available for highest-risk capture tier; redaction-review humans exist |
| **M4 — Brokered aid** | Domains 7/8/9 (medical/mutual/assistance) on **sealed-box one-shot** broker (ratchet deferred), memory-only routing, late reveal, anti-honeypot; **medical/detention onion-only** | Onion origin operated (or flows APK-gated); no money-movement feature (#F wall); briefing/broker humans exist |
| **M5 — Realtime + accountability** | Domain 5 live board (sharded ingest + HLL, memory-only, marshal quorum) with #11 params sign-off; Domain 10 accountability (Review-gate m-of-n) + detainee tracker (#7); Domain 11 AI tier (optional) | #11 params + #4 naming bar + #7 detainee scheme signed off; reviewer quorum + lawyer custodians + incommunicado broker exist |

---

## 13. Top Residual Risks & Human/Counsel Dependencies

The load-bearing problems are **not engineering** — they gate switch-on and no code substitutes for them.

1. **Legal operating entity & jurisdiction (#2)** — gates which data classes may be held at all, and who holds the compellable CF account/signing keys. Blocks every data-holding feature. The offshore foundation must be real before anything signed ships.
2. **Offline key ceremony & root-of-trust distribution (#12)** — the first release depends on a documented multi-person hardware-token ceremony and physical/partner fingerprint distribution, done *before* feature code ships. This is Phase-0, not a late gate.
3. **Off-platform custodians** — lawyer-side detainee identity/dossiers and the **mandatory-offshore evidence key-share** must exist and be operable. The vault's "we cannot produce plaintext" is only true if the client UI has no identity fields and no org-wrapped key copy is ever uploaded — enforced client design + audit, a process guarantee.
4. **Human trust-&-safety org** — a compartmentalized, pseudonymous, hardware-keyed **24/7 moderator + m-of-n reviewer + redaction-confirmer + incommunicado-broker + appeals** org. Because AI is never autonomous, humans are the bottleneck; any feature whose empty-queue failure mode is a safety incident is unshippable until the org is staffed to protest-day surge.
5. **Operated onion origin (later)** — a new compellable party + ops burden + SPOF; a half-operated onion is a false promise. Funded, explicitly staffed, jurisdiction chosen with counsel.
6. **Metadata-store concentration + CF compellability** — a single US legal process yields the full server-side metadata set; the near-term answer is minimization + honest disclosure, the roadmap answer is split-jurisdiction hosting.
7. **App-code TOFU & browser key custody** — best-effort until the Capacitor APK; the highest-risk flows are APK-gated and the limit is disclosed in-product to the users who most need it.
8. **Counsel-set content line (#3) & naming bar (#4)** — peaceful-but-declared-unlawful is the trap; the classifier/charter encode a counsel-set line, and individual naming carries real defamation/UAPA/BNS s.152 exposure to contributors.

**One-line summary:** hold nothing radioactive; hold everything else as ciphertext you cannot read or as public signed content; keep the entity offshore and the money walled; push detainee/perpetrator/donor identity and evidence keys off-platform into privileged or mandatory-offshore-threshold custody; sequence the build behind the legal/organizational critical path; and be honest, in-product, about the metadata, code-integrity, and coercion limits this stack cannot remove.


---

## 14. Version & Cloudflare-Docs Verification (cross-checked 2026-07-22)

*Every Cloudflare primitive claim above was re-checked against the live Cloudflare docs MCP, and every planned library against its latest release/changelog, on 2026-07-22 (12 verification agents, 169 source lookups). **Where this section conflicts with the body above, THIS section is authoritative.** The most load-bearing inline claims have also been corrected in place (§3.1 connection limit, §3.2 DO PITR, §4.4 R2 Bucket Locks, §4.4/§7.4 embedding models, §3.1 off-isolate image work). Pin the versions in the table below in Session 3's `package.json` / CI.*

### Corrections (things the doc got wrong or that changed post-cutoff)

Ordered most load-bearing first. Includes all OUTDATED / INCORRECT findings plus the two limit/behavior changes and the one open-question resolution the brief flagged as load-bearing even though their verification verdict was "confirmed-with-update."

| Topic | What the doc says | Current reality (date / version) | Edit to make |
|---|---|---|---|
| Workers simultaneous open connections | 6 connections counted for whole request lifetime; `Response closed due to connection limit` cancellations | Relaxed **2026-04-09**: only ≤6 connections may be *awaiting response headers* at once; a connection stops counting once headers arrive. Old lifetime-counting and the `Response closed due to connection limit` exception are gone. | State the new semantics. Mark concurrent fan-out (stream from R2 while fetching) as safe so long as ≤6 are awaiting headers. Remove any mention of the old cancellation error. |
| Workers subrequests limit | Hard cap 10,000 subrequests/request | **2026-02-11** the 1,000 limit was removed; Paid default is 10,000 but **configurable up to 10,000,000** via `limits.subrequests` in wrangler. Free stays 50 external / 1,000 internal. | Reword from a fixed "10,000/request" cap to "default 10,000 on Paid, configurable to 10,000,000 via `limits.subrequests`." |
| DO SQLite PITR — can it be disabled? (open question, compellability-load-bearing) | Open question: keep hot-path state (LiveBoard/Broker/RateLimit/CIB) memory-only because DO SQLite PITR is compellable | **No documented mechanism** to disable PITR or shorten the 30-day window per-namespace/class/object. Since **2026-07-09** new namespaces are forced onto the SQLite backend, so there is no PITR-free DO storage. | Resolve affirmatively: PITR cannot be disabled and 30 days cannot be shortened; the only mitigation is to never write that state to `ctx.storage` (keep it in-memory). This *validates* the memory-only design. Caveat: inferred from docs silence — confirm via Cloudflare compliance channel if legally load-bearing. |
| Queues throughput / concurrency | ~400 msg/s per queue, ~20 concurrent consumers | **5,000 msg/s per queue** (Apr 2025); max **250** concurrent push-consumer invocations; 10,000 queues/account; 25 GB backlog/queue; consumer wall-clock 15 min. | Replace 400 msg/s → 5,000 msg/s; 20 consumers → 250. Remove legacy figures. |
| R2 Object Lock via S3 API | R2 provides Object Lock (immutability) via the S3 API | **INCORRECT** — S3 Object Lock headers are Not Implemented (❌). Immutability is a Cloudflare-native **Bucket Locks** feature (GA **2025-03-06**), set via Wrangler/dashboard/CF REST API; fixed-duration / until-date / indefinite, per-prefix, ≤1,000 rules/bucket. | Rename to "Bucket Locks (retention policies)"; configure via `wrangler r2 bucket lock add`. Do not rely on S3 SDK object-lock calls. |
| SLSA level from attestations | `actions/attest-build-provenance` gives SLSA Build **Level 3** out of the box | **INCORRECT** — GitHub Artifact Attestations produce SLSA v1.0 Build **Level 2** by default. Since v4 the action is a thin wrapper over `actions/attest`. | Correct "Level 3" → "Level 2 (default)". Pin by full SHA; consider calling `actions/attest` directly. Verify with `gh attestation verify --owner <org>`. |
| Multilingual embedding model | `@cf/baai/bge-m3` is the recommended embedding model | bge-m3 still available, but newer preferred models ship: **`@cf/google/embeddinggemma-300m`** (768-dim, Sep 2025) and **`@cf/qwen/qwen3-embedding-0.6b`** (1,024-dim, 4,096 tokens, Apr 2026). Both cover en/hi. Vectorize index dimension is immutable after creation. | Prefer embeddinggemma-300m (latency) or qwen3-embedding-0.6b (longer chunks); keep bge-m3 only for sparse/multi-vector or long context. Fix Vectorize index dim (768 or 1024) to match. |
| Wrangler major version | Assumes Wrangler v3 / unspecified | **Wrangler v4** (v4 GA 2025-03-13); latest **4.112.0** (~2026-07-17). Breaking: drops Node 16, removes `--node-compat`/`node_compat`/`usage_model`/`--legacy-assets`/`getBindingsProxy()`/`version`/`publish`/`generate`/`pages publish`; **kv/r2 default to local — need `--remote`**. | Pin `wrangler ^4` (Node ≥18 LTS). Audit CI kv/r2 scripts for `--remote`. Remove `node_compat`/`usage_model`; use `nodejs_compat` flag. |
| Worker types story | Add `@cloudflare/workers-types` with a dated entrypoint (e.g. `/2023-07-01`) in tsconfig | `wrangler types` is now preferred (generates `worker-configuration.d.ts` + `Env`). **workers-types v5 (2026-07-03) REMOVED all dated entrypoints** — only default + `/experimental`; a dated import breaks under v5. | Replace with a `wrangler types` predev/CI step; drop dated-entrypoint imports; pin `^5` only if still installed, or remove the direct dep. |
| Workers logging config | External logpush/tail; no observability block in wrangler config | Native **Workers Logs**, configured in wrangler: `"observability": { "enabled": true, "head_sampling_rate": 1 }`. Enabled by default for new Workers but must be committed to config to persist across deploys. | Add the observability block to `wrangler.jsonc` as source of truth; consider `head_sampling_rate < 1` at scale. |
| Vite major version | Vite 5/6/7 | **Vite 8** — latest **8.1.5** (~2026-07-15); 8.0 GA ~Apr 2026. Requires Node 20.19+/22.12+; default target `baseline-widely-available`. SvelteKit 2.69.x supports Vite 8. | Pin `vite ^8.1.x`; bump CI Node baseline to 20.19+/22.12+. |
| i18n adapter | `@inlang/paraglide-sveltekit` | **Paraglide 2.x** (latest **2.20.2**). BREAKING: framework-specific adapter removed; use framework-agnostic `@inlang/paraglide-js/vite`. Locale-switch links need `data-sveltekit-reload`. | Pin `@inlang/paraglide-js ^2.20.x`, switch to the Vite plugin import, add `data-sveltekit-reload` on language links. |
| Sigstore cosign | cosign v2.x, legacy `--bundle`/verification-material flags | **cosign v3 GA 2025-10-08**; latest **v3.1.2** (2026-07-17). New Sigstore bundle format, `trusted_root`, `signing_config` are defaults; aligns with **Rekor v2**. v2 flags removed in future v4. | Pin cosign **v3.1.2** (via SHA-pinned `cosign-installer`). Reference new bundle/trusted_root defaults + Rekor v2; stop documenting v2 flags. |
| Native shell (Capacitor) | Capacitor v6/v7 | **Capacitor 8.4.1** (2026-06-19). Android minSdk 24 / compile+target SDK 36, iOS target 15.0, **SPM default on iOS**, Node 22+, Xcode 26+, Kotlin 2.2.20. (v9 is alpha.) | Target Capacitor 8; pin `@capacitor/* ^8.4.1`. Update CI matrix (JDK 21, Node 22, Xcode 26, SDK 36). Don't ship v9 alpha. |
| Bundled Tor transport (Arti) | Arti pre-1.x / experimental for embedding | **Arti 2.0.0** (2026-02-02), past 1.0; onion-service client+service + RPC. Official **Arti Mobile** bindings (guardianproject) for Android/iOS. Breaking: old proxy/dir-auth config syntax removed. | Target `arti-client` 2.x + Arti Mobile bindings; drop legacy proxy/dir-auth config. Prefer embedding over shelling to Orbot where in-process is desired. |
| C2PA web/JS library | `c2pa` (c2pa-js) top-level package | Top-level `c2pa` (0.30.17) **DEPRECATED**; repo restructured June 2026. Use **`@contentauth/c2pa-web` 0.12.1** (browser) + **`@contentauth/c2pa-node` 0.6.1** (Node/sign). Spec advanced to **C2PA 2.x (2.4)**. | Replace `c2pa` with `@contentauth/c2pa-web ^0.12.1` (and c2pa-node for server signing). Target spec 2.x; pin exact minor (0.x, breaking). |
| @noble/curves | v1.x | **v2.2.0** (2026-04-12) — ESM-only, Node ≥20.19, mandatory `.js` import extensions, `toRawBytes→toBytes`, `randomPrivateKey→randomSecretKey`, ECDSA prehash/lowS defaults. | Pin `^2.2.0`; add v1→v2 migration note; import Ed25519/X25519 from `@noble/curves/ed25519.js`. |
| @noble/hashes | v1.x | **v2.2.0** — ESM-only, Node ≥20.19, `.js` extensions; import from `@noble/hashes/sha2.js`, `@noble/hashes/hkdf.js`. | Pin `^2.2.0`; update import paths. |
| @scure/bip39 | v1.x | **v2.2.0** (~2026-04) — ESM-only, `.js` extensions, Node 20.19+. | Pin `^2.2.0`; ensure ESM toolchain; pair with @noble/hashes v2. |
| @scure/base | v1.x | **v2.2.0** (~2026-05) — ESM-only v2 conventions. | Pin `^2.2.0`; verify base-encoding import paths. |
| zizmor (Actions linter) | Prior 1.x | **v1.27.0** (2026-07-14). New audits: `typosquat-uses`, `unsound-ternary`, `adhoc-packages`; per-audit severity remap; `--no-ignores`. | Pin action by SHA + version 1.27.x; enable `typosquat-uses` + `adhoc-packages`; run `--pedantic`/online with SARIF upload. |
| harden-runner | Linux-only | **v2.16–2.17**; **Windows + macOS support added early 2026**; K8s self-hosted runners supported. | Pin by SHA (v2.17.x); `egress-policy: block` with allowlist; enable on Windows/macOS runners if in matrix. |
| Dependency updater | Renovate over Dependabot | 2026 default flipped for single-package GitHub repos: **Dependabot** now defensible (grouped updates + Advisory-wired security PRs). Renovate still for monorepos/complex policy. | Recommend Dependabot (npm + github-actions + docker) with grouped updates for this single repo. State "do not run both." |
| CycloneDX SBOM | Spec 1.5/1.6, generic cyclonedx-cli | **CycloneDX 1.7** (~2026-03-25); use **`@cyclonedx/cyclonedx-npm` 6.0.0** (or cdxgen 12.1.4); cyclonedx-cli only for merge/convert. | Target spec 1.7; generate with `@cyclonedx/cyclonedx-npm` 6.x; attest SBOM via cosign/actions-attest. |

### New capabilities worth adopting

- **Image decode / pHash off the isolate** — In-isolate pixel decode is still blocked by the 128 MB / CPU limits, but two supported off-isolate paths now exist: **Images binding `env.IMAGES`** (GA; `.transform()`, `.info()` without decoding in JS) for normalize/resize, and **Cloudflare Containers** (up to 4 vCPU / 12 GiB, R2 FUSE mount; ffmpeg/OpenCV/pHash) for heavy image or any video work. *Change:* route the perceptual-hashing pipeline to the Images binding and/or a Container service instead of the Worker isolate.
- **Cloudflare Email Sending (public beta, 2026-04-16)** — Workers can send arbitrary transactional email via a `send_email` binding: `env.EMAIL.send({from,to,subject,html,...})`. Requires Workers Paid + domain onboarding (SPF/DKIM). *Change:* use the native binding for verification/reset/notification email instead of a third-party SMTP provider; keep a fallback provider since it's Beta (no GA SLA).
- **WebAuthn PRF for at-rest key wrapping** — PRF gives a deterministic 32-byte passkey-bound secret to unwrap the data key with zero server knowledge (Chrome 132+, Firefox 139+, Safari 18+, Windows Hello 25H2). *Change:* derive/unwrap the master key from the `prf` extension, import as a non-extractable AES-GCM `CryptoKey`, store only wrapped material in IndexedDB; document the transient JS-exposure caveat; keep non-extractable-key baseline as fallback.
- **AI Gateway Guardrails + Firewall for AI (both GA)** — Provider-agnostic Llama Guard-based prompt/response moderation with flag-or-block, hazard categories, DLP (PII), and analytics; Firewall for AI blocks unsafe prompts at the WAF layer (Hindi supported). *Change:* route model traffic through AI Gateway Guardrails instead of hand-rolling `llama-guard-3-8b` calls for centralized en/hi moderation. (Note: AutoRAG is now **AI Search**.)
- **Access Independent MFA (GA 2026-04-15)** — Enforce `security_key`/`piv_key` per-application/per-policy in Access, decoupled from the IdP. *Change:* require a hardware FIDO2 key on the privileged-console app specifically while leaving the broader org on weaker MFA.
- **Queues on Free plan + `env.QUEUE.metrics()` (2026-02 / 2026-04)** — Realtime `{backlogCount, backlogBytes, oldestMessageTimestamp}`; Queues now on Free (24h retention); configurable `message_retention_period` (60s–14d). *Change:* adopt `metrics()` for backlog-based autoscaling/alerting; set an explicit retention period.
- **DO 2026 additions** — **Data Studio** (view/edit DO SQLite without deploying a Worker), **Container-backed DOs** (Linux sidecar as the escape hatch beyond 128 MB), **Memory Usage metrics** (P50–P999 vs the 128 MB ceiling), **`us`/`eu` jurisdiction pinning + `ctx.id.jurisdiction`** for data residency, **32 MiB WebSocket messages**. *Change:* alarm on P99 memory; use Data Studio for CIB/audit debugging; adopt jurisdiction pinning if residency matters; a Container-backed DO is the growth path, not a bigger isolate.
- **Smart Placement hints + `run_worker_first` route arrays** — Smart Placement is now sticky (won't revert on traffic dips) and supports explicit `placement.region`/`host`/`hostname` hints; `run_worker_first` accepts an array of glob/`!`-negated route patterns (Wrangler ≥4.20, Vite plugin ≥1.7). *Change:* if there's a fixed regional origin, set an explicit `placement.region`; run the SvelteKit worker only on `/api/*` while serving the SPA shell directly.
- **Offline PWA service worker** — Prefer **`@vite-pwa/sveltekit`** (Workbox precache + auto SW; set `serviceWorker.register=false` in `svelte.config.js`) over a fully hand-rolled worker; SvelteKit's built-in `$service-worker` remains the zero-dep fallback.
- **Turnstile new modes** — `execution:'execute'` + `appearance:'interaction-only'` defers the challenge to submit-time (most users never see it); `size:'flexible'` for responsive PWA layout. Use a Svelte-native client SDK (below).
- **Shamir Secret Sharing** — Adopt Privy's audited (Cure53 + Zellic) `shamir-secret-sharing` for m-of-n key backup. No audited SLIP-39 JS lib exists — treat SLIP-39 as build-vs-defer.
- **FROST(ed25519) now exists** — `@noble/curves` 2.x ships an RFC 9591 FROST implementation (`ed25519_FROST`). Keep threshold-Ed25519 deferred for production (maintainer flags it **unaudited**) but reference it as the concrete future path.
- **Supply-chain enforcement** — Add the org/repo-level **"require SHA-pinned actions" policy** (GitHub, since 2025-08-15) on top of `ratchet`; wire Dependabot's github-actions ecosystem to bump pinned digests. Evaluate **Betterleaks** as the actively-developed successor to now-patch-only gitleaks (verify provenance first).
- **`@cloudflare/vite-plugin`** — GA (v1.0, 2025-04-08). ⚠️ Conflicting signals in the raw results: Cloudflare's **official SvelteKit guide keeps `@sveltejs/adapter-cloudflare`** and does *not* put SvelteKit on the Vite-plugin path, while the framework cluster suggested adopting it for workerd-accurate dev. *Recommended:* keep `adapter-cloudflare` for the SvelteKit app; reserve `@cloudflare/vite-plugin` only for a separate non-SvelteKit Vite Worker (API/React micro-app). Re-verify SvelteKit interop before adopting it in the SvelteKit build.

### Pinned versions

| Name | Pin | Note |
|---|---|---|
| svelte | `^5.56.x` | Svelte 5 + runes stable default; no Svelte 6. |
| @sveltejs/kit | `^2.69.x` | SvelteKit 2; supports Vite 8 + Svelte 5 runes. |
| @sveltejs/adapter-cloudflare | `^7.2.x` | Single adapter; target Workers Static Assets (`assets.directory`/`assets.binding`, not `site.bucket`). Don't use deprecated `adapter-cloudflare-workers`. |
| vite | `^8.1.x` | Node 20.19+/22.12+; `baseline-widely-available` target. |
| @inlang/paraglide-js | `^2.20.x` | Use `@inlang/paraglide-js/vite`; add `data-sveltekit-reload`. |
| @cloudflare/vite-plugin | `^1.45.x` *(only if a non-SvelteKit Vite Worker is added)* | Not the SvelteKit path today. |
| wrangler | `^4.112.x` (dev) | Node ≥18 LTS; kv/r2 need `--remote`. |
| @cloudflare/workers-types | `^5` or **remove** | Prefer `wrangler types`; drop dated entrypoints (removed in v5). |
| hono | `^4.12.x` | Only for a dedicated API Worker. |
| aws4fetch | `1.0.20` | Stable but maintenance-mode (last release Aug 2024); cover presign path with a test. |
| idb | `^8.0.3` | Standard IndexedDB promise wrapper. |
| @noble/curves | `^2.2.0` | ESM-only v2 breaking changes. |
| @noble/hashes | `^2.2.0` | ESM-only; `sha2.js`/`hkdf.js` paths. |
| @noble/ciphers | `^2.2.0` | One-shot XChaCha20-Poly1305 (wrap `managedNonce`); no streaming secretstream. |
| @scure/bip39 | `^2.2.0` | ESM-only. |
| @scure/base | `^2.2.0` | ESM-only. |
| libsodium-wrappers-sumo | `^0.8.4` | `crypto_box_seal` + `crypto_secretstream`; ~300 KB WASM — lazy-load. |
| shamir-secret-sharing (privy-io) | latest | Audited Cure53 + Zellic; raw SSS (no SLIP-39). |
| @contentauth/c2pa-web | `^0.12.1` | Browser read/verify; C2PA 2.x. Pre-1.0. |
| @contentauth/c2pa-node | `^0.6.1` | Node read/verify + signing. |
| svelte-turnstile *or* @battlefieldduck/turnstile-svelte | `^0.11.0` / latest (Jan 2026) | Latter bundles server siteverify; server-side siteverify mandatory either way. |
| minisign (npm) | current major, lockfile-pinned | Browser/Node verify. |
| @capacitor/core, /cli, /android, /ios | `^8.4.1` | Not v9 (alpha). |
| arti-client (crate) | `2.x` | + Arti Mobile bindings. |
| Model: Llama Guard | `@cf/meta/llama-guard-3-8b` | Native Hindi support; billed per-token. No Llama Guard 4. |
| Model: embeddings | `@cf/google/embeddinggemma-300m` (768) or `@cf/qwen/qwen3-embedding-0.6b` (1024) | Match Vectorize index dim (immutable). |
| cosign | `v3.1.2` | Via SHA-pinned `cosign-installer`; Rekor v2. |
| actions/attest-build-provenance | `v4.1.1` (pin by SHA) | Or call `actions/attest` directly; grants SLSA L2. |
| rsign2 | `0.6.6` | CI minisign signing. |
| zizmor / zizmor-action | `1.27.x` (action by SHA) | Enable typosquat/adhoc-package audits. |
| step-security/harden-runner | `v2.17.x` (by SHA) | `egress-policy: block`. |
| gitleaks | `v8.30.1` | Patch-only now; evaluate Betterleaks. |
| syft | `v1.48.0` | Emit CycloneDX 1.7; attest SBOM. |
| grype | latest | Pair with syft for CVE scan. |
| @cyclonedx/cyclonedx-npm | `6.0.0` | CycloneDX 1.7; cdxgen 12.1.4 for multi-lang, cyclonedx-cli for merge. |

### Confirmed (no change)

- **Hosting**: `@sveltejs/adapter-cloudflare` → Workers + Static Assets is the current path; Cloudflare steers new projects to Workers over Pages.
- **Static Assets**: free/unbilled; `not_found_handling:"single-page-application"` and `run_worker_first` config keys current (latter now also accepts route-pattern arrays).
- **Workers Paid limits**: CPU 5 min, 128 MB memory hard ceiling (Free and Paid), Worker size 10 MB, 500 Workers, 250 Cron Triggers.
- **Durable Objects**: SQLite-backed DOs GA (2025-04-07) + on Free tier; SQLite now mandatory for new namespaces (2026-07-09); 10 GB per object; WebSocket Hibernation API current (32 MiB messages; `web_socket_auto_reply_to_close` default for compat ≥2026-04-07); Alarms API current; **PITR window is exactly 30 days and cannot be disabled**; single-threaded, 128 MB per-*isolate*; billing = requests + duration, plus new SQLite storage billing (2026-01-07).
- **D1**: 10 GB/db (Paid), 500 MB (Free); Time Travel 30 days (Paid), always-on/cannot disable; billed rows_read/rows_written + storage; Sessions API read replication available (public beta); migrations forward-only (new `migrations_pattern` config).
- **Queues**: 128 KB max message; batch 100; max_retries 100; DLQ supported (silently drops without one); push + pull consumers both supported.
- **R2**: presigned URLs via S3 API + aws4fetch confirmed; multipart uploads (5 TiB / 10,000 parts / 5 MiB–5 GiB); **free egress**; event notifications to a Queue (object-create/object-delete only).
- **Workers AI / Vectorize**: `@cf/meta/llama-guard-3-8b` available with Hindi; 10,000 Neurons/day free + Batch Inference API; Vectorize supports only cosine/euclidean/dot-product (no Hamming), max 1,536 dims, 10M vectors/index — pHash Hamming search must stay outside Vectorize.
- **Security/edge**: Turnstile free; WAF custom rules + rate-limiting rules per-plan caps confirmed (custom keying needs Business+); Zero Trust Free ~50 seats; Access supports FIDO2/passkeys; Transform Rules can only *remove* `cf-connecting-ip`/XFF (proxy re-adds XFF; CF still logs IP); `opportunistic_onion` still exists (opportunistic, not censorship-circumvention).
- **CI/CD**: **No OIDC-to-Cloudflare path** — still a long-lived scoped API token (Discussion #11434 / wrangler-action #402 open as of 2026-06); `wrangler deploy --temporary` is explicitly NOT a CI/CD substitute. Secrets Store still Beta. Sigstore keyless (Fulcio/Rekor) + build-provenance approach current. minisign/rsign2 signing current. syft+grype pattern current.
- **Client/crypto**: `@noble/ciphers` XChaCha20-Poly1305 and `libsodium-wrappers-sumo` (`crypto_box_seal`/`crypto_secretstream`) confirmed; ProofMode / Simple C2PA current for capture provenance. Privacy Pass RFCs (9576/9577/9578) stable but **no audited npm implementation** — treat as custom-build/defer.

---

## 15. Progressive Trust & Safety (autonomous-first, human-hardened)

Harborage supports an **ongoing** protest. Real protestors and the public use it **from day 1 — before** a vetted human trust-&-safety org exists. Therefore the autonomous **AI + community + reputation** layer is the **day-1 core** that must stand alone and stay true and credible with **zero moderators online**; the human org is a **hardening milestone layered in "at the scale it demands,"** not a launch prerequisite. This reverses the prior "AI-deferred / human-org-is-a-switch-on-interlock" posture — **for the reversible surface only.** Every irreversible high-harm action stays m-of-n human-gated and ships **kill-switched OFF**.

The single organizing rule:

> **AI + community may act autonomously only on REVERSIBLE, NON-CATASTROPHIC actions. Every IRREVERSIBLE, HIGH-HARM action stays m-of-n human-gated and ships OFF until reviewers exist.**

**Load-bearing honesty (from the adversarial review, now first-class):** the threat actor is a **STATE**. The whole credibility argument reduces to one wall — the source-diversity / independence corroboration test — and a resourced state (aged accounts on distinct residential/mobile networks, generative/staged media, CAPTCHA farms) **can climb that wall**. So this design **does not claim** autonomous verification defeats a determined state op. It claims something narrower and true: the **autonomous ceiling is held deliberately low** (below any label or reach a user would treat as reliable-for-action), the highest-harm content classes are **never autonomously amplified**, suppression levers are closed, and **nothing good is destroyed** while humans are absent. Credibility comes from **honest labeling + a low ceiling + reversibility**, not from pretending the wall is unclimbable.

### The two layers, and the transition

- **LAYER A (day-1, autonomous):** Tier-0 lexical floor + AI Gateway Guardrails / `llama-guard-3-8b` (en/hi) + embeddings→Vectorize + pHash + community response (report/corroborate/upvote/downvote/flag) + earned per-compartment scalar reputation. Drives **verification-state, reach/ranking, and quarantine-PENDING (hide-not-delete)** with **no human in the loop** — restricted by construction to reversible, non-catastrophic actions, honestly labeled "algorithmic/community, NOT human-verified." **Autonomous ceiling = `Community-Corroborated` with a capped, sub-amplification reach** — it never earns "Verified" language and never reaches the top reach tier.
- **LAYER B (hardened, capacity-keyed):** vetted pseudonymous reviewers, added at measured throughput, (i) take over high-stakes + appeals, (ii) **unlock** the human-gated actions that shipped OFF (individual naming, unredaction, per-case precise reveal, permanent deletion), (iii) add the one state Layer A refuses — **`Human-Verified`**, the only state that carries "verified" language and full reach — and (iv) **retroactively audit and override** Layer-A verdicts, feeding corrections back as reputation and threshold signal.

The transition is **continuous and per-action**, gated on measured human **throughput** (read from a `FlagState` DO), never a calendar date and never a single "org exists" boolean. Human review **sits above** the pipeline draining queues and operating the m-of-n gates; it never rebuilds it.

### THE DECISION MATRIX (autonomous vs human-gated)

`AI-alone` = classifier/state engine, no human. `AI+community-thr` = requires reputation-weighted, independence-gated community threshold (see state machine). `NOBODY / OFF` = kill-switched; no autonomous path exists in code.

| # | Action | Reversible? | Layer A — day-1 (autonomous) | Layer B — hardened (human) |
|---|---|---|---|---|
| 1 | **Assign verification state** | Yes | AI-alone sets default `Unverified` + `AI-Screened`; **AI+community-thr** drives `Corroborating`/`Community-Corroborated`/`Disputed`/`Debunked`. Ceiling = `Community-Corroborated` | Humans set **`Human-Verified`** (unreachable autonomously); override any provisional; retroactive relabel (append-only, visible) |
| 2 | **Rank / amplify (up-rank)** | Yes | AI+community-thr; reach = pure function of state × √-damped author-rep. **Autonomous max reach is capped below full amplification** | `Human-Verified` unlocks the top reach tier that autonomous states cannot reach |
| 3 | **Down-rank** | Yes | AI-alone (quality/risk) + community signal | Human audit + override; feeds threshold tuning |
| 4 | **Quarantine-PENDING (HIDE, not delete)** | Yes | AI-alone on high-risk (≥0.85, two-signal) — immediate; **AND** community path (independent, AI-concurred, CIB-clear). Retained-pending, auto-re-review | Single-reviewer confirm/release; latency hours→minutes |
| 5 | **Auto-purge radioactive public payload** | Reversible-in-effect | AI-alone, **narrowest scope only**, split by target (see Red-line reconciliation). Two independent signals; audit row kept; vault original untouched | Humans review audit rows, tune thresholds, measure false-purge rate |
| 6 | **Publish INDIVIDUAL identity (accountability naming)** | **No — irreversible** | **NOBODY / OFF.** Institutional-pattern accountability at **non-individually-resolvable granularity only** launches autonomously | **Unlocks** the m-of-n Naming Review-gate (default WITHHELD, 7 conditions). Red-line-2 stays stricter default-DENY |
| 7 | **Unredact evidence** | **No** | **NOBODY / OFF.** Auto solid-fill redaction runs; undoing never runs autonomously | Multi-person-gated, logged, watermarked, reviewer-wellbeing safeguards |
| 8 | **Reveal precise location** | **No — red line 3** | **NOBODY / OFF.** Only coarse geohash-zone / crowd-band. No live precise-GPS, no who-was-where log — **ever** | Public precise broadcast + persistent who-was-where **never unlock**; only the narrow aid-matching per-case reveal (human + two-responder + late-mutual-reveal) |
| 9 | **Permanent delete of evidence** | **No** | **NOBODY / OFF.** Default = quarantine hides + retains | m-of-n human; restricted-access retention preferred over deletion |
| 10 | **Resolve appeal** | Yes | AI-alone auto-recovery: fresh classifier pass + community re-vote + reputation recheck; auto-restore if it clears; **always queue for humans** | Human adjudication with SLA; m-of-n for high-stakes appeals; retroactive override sweeps |

Rows 6–9 are the explicit **"cannot be safe without humans"** set. They are implemented, wired, tested, then left **OFF** behind an **unsatisfiable m-of-n quorum** (empty reviewer-key directory ⇒ fail-closed by construction). Row 8's public-precise and who-was-where sub-cases **never unlock at any capacity**.

### The verification-state machine (AI + community + reputation)

States, with the **one canonical reach table** below as the single source of truth (resolving prior cross-doc contradictions). **Feed baseline = 1.0** (plain chronological placement). "Amplified" means reach **> 1.0**. "Never amplified" means reach **≤ 1.0**.

```
 (default) → UNVERIFIED ──AI clean──► AI-SCREENED ──indep-corrob──► CORROBORATING
                                                                        │
                                            §independence bar + AI concur, dwell
                                                                        ▼
                                                            COMMUNITY-CORROBORATED   ← autonomous ceiling
                                                                        │              (labelled "NOT human-verified")
                                                              Layer B only │
                                                                        ▼
                                                                 HUMAN-VERIFIED       ← only "verified" state
 side states:  DISPUTED (contested label)      DEBUNKED (hard-evidence only)      QUARANTINE-PENDING (hidden, retained)
```

**Canonical reach table (build to exactly this; conformance-tested):**

| State | Reach vs baseline | Notes |
|---|---|---|
| Quarantine-Pending | **hidden (0)** | author + future-reviewer visibility only; retained-pending |
| **Unverified** (default) | **1.0 (baseline, chronological)** | **NEVER pushed/recommended/boosted.** Absence of provenance shown neutral, never as guilt |
| AI-Screened | **1.0** | "not obviously unsafe" ≠ true; badge differs, reach identical to Unverified |
| Corroborating | **≤ 1.3 (area/topic cohort only)** | modest, labeled; **autonomous fast-tier is rate-limited** (see directive class) |
| **Community-Corroborated** | **≤ 1.5 (autonomous ceiling)** | labeled "AI-checked & community-corroborated, **NOT yet human-verified**." Never full amplification |
| Disputed | **see rule below** | contested **label**; reach depends on **dispute provenance** |
| Debunked | **0.3** | hard-evidence only; correction attached; retained, re-reviewable |
| **Human-Verified** (Layer B) | **up to 3.0** | only state with "verified" language and top reach |

**Disputed reach rule (closes the muddy-the-waters suppression lever):** a dispute **only** clamps reach if the counter-signal **itself clears the same independence-diversity bar** as verification. A counter-cluster that is CIB-attributed or fails independence-diversity is treated as an **attack signal, not disagreement**: the item keeps its **earned reach** and only gains a contested label. **No genuinely-corroborated item can ever be pushed below baseline by synthesized disagreement** — this is a hard invariant with a conformance test.

**Promotion conditions (defaults; KV/counsel-tunable, heightened-mode multiplies):**

| Transition | Conditions (ALL) |
|---|---|
| Unverified → AI-Screened | `llama-guard` safe + Tier-0 clean |
| AI-Screened → Corroborating | ≥ **2** independent corroborators, `C ≥ 3.0`, **min-dwell ≥ 15 min** (even here — closes the false-directive fast-path), no open CIB |
| Corroborating → **Community-Corroborated** | ≥ **K=4** distinct corroborators across ≥ **S=3** independence buckets, `C ≥ 6.0`, `C/F ≥ 3:1`, **min-dwell ≥ 60 min**, **≥1 corroborating item whose media-provenance chains to a prior-established high-rep source in a different compartment**, AI concurs, no open CIB, **cohort-pivot detector clear** |
| any → Disputed | independence-passing counter-cluster **or** AI↔community disagreement (reach rule above applies) |
| any → Debunked | **hard evidence only** (exact pHash to known-debunked / provable provenance contradiction) |
| → Community-Corroborated / Human-Verified | never for **directive/operational** content (separate class, below) |

**Two anti-manipulation invariants baked in:** (1) **a flag storm cannot bury truth** — coordinated identical flags are a **CIB signal, not consensus**: item routes to **Disputed + human queue**, never auto-suppressed; (2) **a mob cannot verify a falsehood cheaply** — promotion needs source-diverse, independence-gated, reputation-gated credit **plus** an independent anchor **plus** AI concurrence, and the top state (`Human-Verified`) is unreachable autonomously.

### Directive / operational content — a never-autonomously-amplified class (new)

Real-time operational directives ("teargas at north gate, move south," "organizers say regroup at Gate 5," "police clearing, disperse") are the **highest-harm disinfo** and the **fastest-traveling** — and `llama-guard` gives **zero** resistance (a false directive violates no hazard category). So directive/logistics/call-to-action content is carved into its **own class**:

- **Never autonomously amplified above baseline (1.0)**, regardless of corroboration state — it can reach `Community-Corroborated`'s label but **not** its reach boost.
- **Hard interstitial always:** "Unverified directive — do not act on this without independently confirming."
- **Mandatory min-dwell** even at Corroborating; **rate-limit** on how fast any item gains area-cohort reach so a minutes-old burst can't drive a crowd.
- **Physical-plausibility cross-check** against the coarse live-board signal where feasible (a "north gate" directive inconsistent with coarse crowd-band is down-weighted).
- Classifier routes ambiguous items **into** this class (fail toward "treat as directive").

### Day-1 AI verification pipeline (Cloudflare primitives)

Public tier only; the **sealed client-side vault original is never server-readable, never sent to Workers AI, never autonomously purged.** Ordering is fail-safe: cheapest/most-decisive safety first, budget-bounded AI next, community continuous, reach last (default: no amplification).

```
submit (public tier)
 └ Turnstile (personhood-lite, Tor-tuned; refuse-not-plaintext fallback) + layered rate-limit (DO token bucket, per-cap-cert / per-ASN-bucket / global)
   └ Tier-0 lexical ($0, always-on): PII/doxx regex, incitement lexicon (en/hi), known-bad pHash, language route
     └ radioactive tripwire? → split-by-target purge/hide (Red-line reconciliation)
     └ SpendCapDO gate (strongly-consistent daily Neuron counter) checked FIRST
        ├ under cap → AI Gateway Guardrails (GA, en/hi) wrapping llama-guard-3-8b (native Hindi)
        │             + embeddinggemma-300m (768-dim, pinned) → Vectorize (cosine): near-dup / recycled-narrative / claim-cluster
        │             + pHash recycled-media (OUTSIDE Vectorize: Images binding / Container, BK-tree/LSH Hamming)
        │             + doxx/PII tripwire (regex + Guardrails DLP + NER-lite), private-individual scope only
        └ at cap → DEGRADE (see spend-cap ladder)
           └ VerificationStateDO (per-item FSM; alarms; append-only audit) ⇄ community layer → reach decision
```

Each stage **emits a normalized signal** `{stage, category, score, lang, advisory, model_version, evidence_ptr, ts}` — **never a verdict, never a deletion.** The `VerificationStateDO` (per-item, SQLite, strongly consistent, serialized so no read-modify-write race under a vote storm) is the **only** thing that mutates authority, and its action vocabulary is a **fixed enum `{label, rank, hide-pending, retain-pending, route-to-gate}`** — there is no code path from a model output to publish/delete/unredact/name. All Workers AI traffic routes **through** AI Gateway so Guardrails also screens model **input and output** (prompt-injection firewall). `llama-guard` is a classifier with no tools; a successful injection at worst corrupts one score, which is checked against the two-signal-agreement rule (**no single classifier is terminal for a takedown**).

**Models & budget:** `@cf/meta/llama-guard-3-8b` (en/hi authoritative; other languages advisory→community-only, never an autonomous adverse verdict), `@cf/google/embeddinggemma-300m` (768-dim, **immutable at index creation**), Vectorize cosine, pHash Hamming outside Vectorize.

### Spend caps & degrade (specified degraded-mode state machine — closes the DoS-to-degrade attack)

Enforced by a **strongly-consistent `SpendCapDO`** (single DO, input-gate-serialized Neuron counter). Before any paid call: `reserve(estimated_neurons)`.

- **Prefilter discipline:** Tier-0 (free) runs on 100% of items; paid S2/S3 run **only on Tier-0/Guardrails-flagged items + a ~2–5% random audit sample.**
- **TRIAGE the budget, not first-come:** a **reserved paid-AI floor** is dedicated to a **high-priority queue** (life-safety / detention / high-reach / accountability) that bulk feed load **cannot consume**. An attacker's submission flood is rate-limited/prioritized so it **cannot starve real incidents of scoring**.
- **Degrade ladder:** `full AI → cheaper-model/prefiltered → Tier-0 + community-only`. **AI-capped is a first-class sustained mode** (a national protest day *will* sit capped), not an emergency.
- **Degraded-mode FSM (explicit, fail-toward-not-suppressing-truth):** at cap, **do not stall truth** — community-only items may still reach **`Corroborating`** (community + Tier-0), but **`Community-Corroborated` is HELD** (its AI-concurrence precondition is unmet) until AI budget returns and a re-scan runs. AI-concurrence is **never silently waived** to unblock promotion. Held items are queued oldest-first for deferred AI re-scan on counter reset. This makes **both** degrade failure modes safe: truth is not frozen, and fabrication is not handed a free pass by dropping the one independent check.

### Community-signal + reputation + manipulation-resistance engine

**The spine:** reach is **never** a function of raw engagement. Votes/flags are **inputs to the state machine, not outputs to the ranker.** A mob can generate unlimited votes; it cannot cheaply generate **independent corroboration** or **earned reputation** — and only those move reach.

**Reputation** — PII-free, per-compartment scalar `r ∈ [0, R_max]`, **no social/follow/vouch graph, no member directory** (invariant); reputation-gated powers carried by **blind-token / anonymous credential** so the server holds no list. New account `r₀ ≈ 0.05` (near-powerless). Vote weight `w = W_cap · √r` (√-damping; a whale cannot dominate; `W_cap` caps any single account). **Hard participation gate `r_gate = 0.15`:** below it, votes/flags count **only** as input to the human queue and CIB detector — never toward an autonomous state or reach change. Reputation is **outcome-settled** (retroactively, on items reaching terminal-ish states), **not** earned by receiving votes; **per-compartment** (feed rep grants zero power in accountability); **decays** (half-life ~60d); **per-epoch gain cap** + age/personhood multipliers make farming slow.

**Corroboration credit (source-diversity is the wall):**
```
C = Σ_clusters min( clusterCap , Σ_{i∈cluster, r_i ≥ r_gate} √r_i ) ,  clusterCap = 1.0,  require K_src distinct clusters
```
Clusters are **ephemeral, behavior-only** (ASN bucket, timing burst, device-class, stylometry-lite, template similarity), scoped to the item's DO window and **discarded on alarm** — **no co-witness or social graph is ever persisted.** A new report increments `independent_source_count` **only** if it clears independence vs existing members: **distinct media provenance** (pHash recycled-media match ⇒ **1** source via `canonical_content_id` — kills "everyone reposts the same clip"), **text novelty**, **behavioral independence** (CIB-clear), **account independence**.

**The four named attacks and their status (honest):**

- **(a) Verify a falsehood** — *raised to expensive, not impossible.* Needs `K/S` distinct independence-passing corroborators past a dwell window **plus** a cross-compartment provenance anchor **plus** AI concurrence. Amateur mobs: defeated. **A resourced state with aged accounts + distinct networks + generative/staged media CAN reach `Community-Corroborated`** — which is exactly why that ceiling is **capped below reliable-for-action reach**, directive content is **never** amplified, and the top state stays human-only.
- **(b) Bury the truth** — **closed.** Flags never auto-remove; mass-flag → CIB → Disputed/hold with the **provenance-aware Disputed reach rule** (synthesized disagreement carries no reach penalty). Flaggers who pile onto a later-verified item **lose reputation**.
- **(c) Doxx / wrongly name** — **structurally impossible autonomously.** Naming is human-gated, ships OFF, quorum unsatisfiable.
- **(d) Astroturf to the top** — **closed for cheap attacks, capped for expensive ones.** √-damping + `r_gate` + `clusterCap` + recycled-narrative/media collapse + behavior-only CIB. Ceiling capped regardless.

**Sleeper reputation-farming (patient state tradecraft) — mitigated, and stated as a residual:** caps/decay/outcome-settlement assume the attacker misbehaves early; they do **nothing** against accounts that behave well for weeks then pivot. Mitigations: **cohort-pivot detection** (a sharp shift — long unrelated independent history suddenly co-corroborating one hot item — is itself a coordination signal **even without a burst**); **weight corroboration by diversity of corroboration history** (accounts that have **never before co-appeared** and have unrelated topic footprints count more than raw earned scalar); **escalating proof-of-work / cost on reputation-earning actions** (not on reading). **Documented limit:** reputation is **not** a sufficient anti-manipulation defense against a patient adversary — which is why the ceiling stays low and naming stays human-gated.

**Sybil foundation (Tor-tuned personhood) — documented hard limit:** Turnstile is deliberately tuned permissive to admit Tor/VPN; commercial CAPTCHA/human-farms can mint personhood-tier accounts cheaply. This is **not fixable to zero** without strong identity (which the anonymity requirement forbids). Therefore: personhood-issuance correlation is a **CIB input** (spikes → heightened-threat trigger), reputation gain leans on **hard-to-fake real-world-outcome anchoring**, and — the load-bearing consequence — **the autonomous ceiling stays low by design.**

**Community notes (bridging, not majority):** context notes show **only** when they earn a `cross_perspective_score` (helpful to raters who usually disagree — Birdwatch-style), computed from **rater diversity**, not count. Notes are additive context, never a takedown lever; a well-rated note pushes the target to **Disputed** (reversible) and feeds re-review.

### Red-line reconciliation

- **Red line 1 (no public target list; official-capacity only):** incident documentation + **institutional-pattern accountability** launch autonomously — but **aggregated ONLY to non-individually-resolvable granularity: station / unit / rank-band / shift.** **Any individually-resolvable identifier — badge number, name, specific vehicle plate, "the officer with the scar" — is moved OUT of the autonomous track** into the human-gated Naming Review-gate. *(Correction applied: a badge number resolves to one human; autonomous "corroborated" misconduct against `badge 1234` is de-facto naming/defamation and a state pretext — it is barred from the autonomous track.)* Individual naming stays **NOBODY/OFF** until the m-of-n org exists.
- **Red line 2 (no plainclothes identity claims):** stricter default-DENY; the asserted identity is **never stored** (only claim + evidence hash); no autonomous path toward publication; **OFF**.
- **Red line 3 (no live precise-GPS / no who-was-where log):** unchanged. Autonomous layer operates on incident/claim content + area-coarse geo only. Precise-location reveal is human-gated and OFF; public-precise + persistent who-was-where **never unlock**.

**Radioactive auto-purge — split by target (closes the "purge real evidence" hole):**

| Content | Autonomous action |
|---|---|
| Private-individual PII **authored as an attack** (doxx), or explicit violence-intent, `llama-guard ≥ 0.95` **AND** Tier-0 corroboration | **Short-purge the public payload** (retaining it is UAPA/BNS-radioactive), keep non-content audit row `{opaque_id, category, action, ts, model_version, confidence}`, **only if a recoverable vault original exists**; else **hide-not-purge** |
| PII appearing as **evidence of state/official doxxing** ("police circulated protestor home addresses — screenshot") | **Quarantine-HIDE + retain-pending + human queue. NEVER autonomous purge** — retention of evidence-of-a-crime is defensible; auto-destroying it aids the perpetrator |
| Uncertain (`llama-guard` 0.80–0.95, single-signal, generic threat) | **Auto-quarantine (hide), retain-pending, do NOT purge** |
| CSAM | hard route out-of-band, never retained, never re-reviewed autonomously |

Purge hold **lengthened** (default now longer than 15 min, KV-tunable) so a legitimate Tor poster can notice and file. **Re-submission is never the only recovery path for high-interest evidence.** **Anti-weaponization:** the doxx tripwire targets **private-individual PII only**; official-capacity records are **out of scope** (they route to the m-of-n gate, never suppression); tripping another account's quarantine is rate-limited + reputation-weighted; coordinated identical tripwire-triggering is a **CIB signal → Disputed/hold**, never autonomous suppression.

### Transparency & honest labeling

Every item shows **provenance** + an **explicit, honest state badge** naming the verdict's nature; the append-only state log makes silent up-labeling detectable:

- Unverified → "**Unverified** — not checked or corroborated. Do not rely on this."
- AI-Screened → "**AI-checked (automated)** — not corroborated, not human-verified."
- Community-Corroborated → "**AI-checked + community-corroborated — NOT yet human-verified.**"
- Disputed → "**Contested** — corroboration and refutation conflict."
- Debunked → "**Debunked** — see attached correction."
- Human-Verified (Layer B) → "**Human-reviewed.**"

A user-facing **honest-limits statement** (onboarding + linked from every badge) states plainly: there are not yet enough human reviewers; "community-corroborated" ≠ human-confirmed-true; automated checks are en/hi only and can be wrong; **a determined coordinated group may have tried to game a label and our defenses reduce but do not eliminate this**; we will never autonomously name an individual, reveal precise location, or unseal evidence; hidden ≠ gone — press "Request re-review"; **contested/uncertain is the normal state under attack, and absence of a Verified label is not evidence of falsity.** *Treat everything as documented, corroborated allegation — not proven fact.*

### Appeals & error-recovery without humans

Nothing good is permanently lost while humans are absent (except illegal-to-retain radioactive payloads, recoverable via re-submission / independent vault original). Every autonomously-actioned item (except short-purge) is **retained-pending**; the item's DO sets an `alarm()`:

- **On every new signal** → recompute.
- **Every T ≈ 6h** → fresh classifier pass (if capped: Tier-0 + community re-vote only — degrade, don't stall).
- **Auto-restore** from Quarantine when hazard < release threshold **AND** flags decayed **AND** CIB cleared.
- **"Request re-review"** button re-runs the full pipeline immediately (rate-limited) and **queues for humans**.
- **Always** enqueue to the human console (behind Access) so reviewers arrive to a waiting, prioritized backlog — the empty-queue failure mode is *"held safely, auto-re-checked,"* not *"lost."* **Disputed items with high independent original corroboration are prioritized to the top of the human queue** (the muddy-the-waters steady state is expected).

### Heightened-threat mode interaction

The existing single composite `FlagState` flip gains trust-layer effects — all **tightening**, all reversible: multiply every corroboration threshold (K 4→6, S 3→4, dwell 60→180 min, C/F 3:1→5:1); **nothing below `Community-Corroborated` is amplified at all** (Corroborating drops to pull-only); **disable low-rep voting** below an `r` floor; lower `llama-guard` hold thresholds (R-High 0.95→0.90); earlier spend-cap degrade; shorten retain-pending timers; force onion-only sends. Human-gated actions stay OFF — heightened mode **never loosens**. Flip latency honestly bounded by per-colo KV TTL (5–10 s), not instant.

### Fail-safe defaults (explicit)

| Situation | Default |
|---|---|
| New content | **Unverified**, chronological, **not amplified** |
| Directive/operational content | **Never amplified above baseline**, hard interstitial, min-dwell |
| AI ↔ community disagree / low confidence | **Disputed / hold** — never a destructive/irreversible action |
| Synthesized (CIB / low-independence) disagreement | Contested **label only**, **no reach penalty** |
| Coordinated flags | **HOLD + auto-re-review** — never auto-suppress |
| Autonomous negative action | **Hide (reversible), retained-pending** — never delete |
| Radioactive payload | Split-by-target; purge **only** private-attack PII with a vault original; else hide-not-purge; audit row |
| Uncertain about independence | Count as **dependent duplicate** (don't increment) |
| AI budget cap hit | Degrade to Tier-0 + community-only; **hold Community-Corroborated**, don't stall Corroborating; reserved paid floor for life-safety |
| Removal vs publication | Removal single-trigger of *hidden* state; **publication/naming quorum-required, fail-toward-not-publishing** |

### Solidification roadmap — keyed to human throughput, not dates

| Phase | Human-capacity trigger | Unlocks | Tightens |
|---|---|---|---|
| **A0** | 0 vetted humans | Full Layer A. #6–9 OFF. Everything append-only-logged. Appeals auto-recover + queue | — |
| **A1** | 1–2 vetted admins (part-time), Access + HW-MFA | **Sampled audit:** 100% of quarantines + 100% of auto-purge audit rows + 100% of Disputed + random 2% of Community-Corroborated. Single-reviewer quarantine release. Humans may stamp `Human-Verified` | Quarantine can go more aggressive (release now fast); AI-path bar → 0.75 |
| **A2** | m-of-n quorum (≥3 distinct role-keys) + counsel sign-off | **UNLOCK #6 individual naming** (Review-gate), **#7 unredaction**, human appeal SLA, **#8 narrow aid-matching precise reveal** | Autonomous ceiling reach **capped down** (humans carry top); Community-Corroborated sampling 2%→10% |
| **A3** | 24/7 org staffed to protest-day surge | `Human-Verified` is the norm for high reach; **m-of-n #9 permanent delete**; continuous retroactive override sweeps | Autonomous top-tier capped further; radioactive auto-purge can **relax** its ≥0.95 bar (humans now backstop the false-positive tail); heightened mode auto-raises thresholds |

As reviewer throughput rises: (a) the **sample fraction** of Layer-A decisions getting human eyes rises toward continuous coverage of high-stakes classes; (b) the **top of the trust ladder migrates** from autonomous `Community-Corroborated` to `Human-Verified`; (c) the **irreversible actions unlock in risk order** (institutional patterns already live → sampled release → individual naming/unredact/precise-aid at quorum → permanent delete at full staffing). Every override is an append-only, publicly-visible relabel that adjusts contributor reputation (still a PII-free scalar — no "who-was-wrong" roster).

---

## 16. Evidence Archive (durable, open, storage-minimized)

Harborage's evidence subsystem gains an **Evidence Archive**: a durable, openly-citable, deletion-resistant record of media documenting official misconduct, built so that removal of the source anywhere else (platform takedown, poster deletion, upstream block) never affects our copy. It extends — does not replace — the existing capture → hash+provenance → PII-scrub + irreversible redaction → dual-output pipeline (ARCH §7.1). The archive defines *what happens to the two outputs* and *how the community builds on them*.

The governing principle, learned from adversarial review, is: **DURABLE is not IMMUTABLE.** The archive is engineered to survive hostile deletion, but it never engineers away its own ability to purge illegal content or correct a poisoned entry. Permanence is *earned per item* by human attestation after a re-scanned probation window — never conferred automatically by the autonomous admission path.

### The two layers, and what each guarantees

| | Public redacted archive | Sealed E2E vault |
|---|---|---|
| **Holds** | ONE optimized, verified, PII-scrubbed, face/plate-redacted, **non-radioactive** derivative per unique media | ONE pristine original per unique media (exact-byte deduped), client-side XChaCha20-Poly1305 |
| **Custody class** | PUBLIC-PLAINTEXT (safe to be permanent, public, citable, mirrored) | CLIENT-SIDE E2E (platform cannot read; keys off-platform, Shamir threshold) |
| **Key scheme** | Content-addressed on the **derivative hash** | **Opaque ULID** (no content/identity/time in key — preserves ARCH §4.4 invariant) |
| **Guarantees** | Durability + integrity + open verifiability of the *redacted evidentiary rendering* | Chain-of-custody anchor: the exact submitted bytes are preserved and re-hashable, unreadable by the platform |
| **Openly documented?** | Yes — this is the authoritative public record | No — existence acknowledged, contents never disclosed |

Both layers are durability targets. Only the public layer is openly documented and mirrored in plaintext; the vault replicates as **ciphertext only**.

### The admission rule (explicit, fail-closed)

**A byte becomes permanent/public ONLY if ALL of these hold**, each logged to the custody chain:

1. **Verified** — the autonomous trust pipeline (AI signals + community corroboration + reputation) reached the admission threshold, with independent multi-source corroboration (§ anti-poisoning below).
2. **Redaction confirmed** — automated face/plate/ID + PII detection proposed irreversible solid-fill redaction, and it was *human-confirmed*: submitter before/after confirm for own capture, or ≥2 independent established-contributor confirms for third-party import. Any uncertainty → **SEALED_ONLY** (vault only, never public). Redaction review also assesses **contextual re-identification** (location, signage, clothing, tattoos, event uniqueness) — face-cover alone is not anonymization.
3. **Non-radioactive** — passes Tier-0 lexical + known-bad pHash + CSAM hash-match screening (AI advisory later, per ARCH §7.4). Any hit → auto-quarantine → short-purge. Radioactive content is **never transcoded, never deduped into the permanent set, never locked, never replicated.**
4. **Optimized derivative produced** (below).

Unverified/quarantined items are never in the permanent public archive and are never amplified — reach is earned by verification, not engagement. Pristine originals and victim identities **never** enter the public layer.

### Deletion-resistance — separated from immutability

Four mechanisms, applied **in sequence, only after certainty grows**:

**1. Content-addressed storage (public layer).** The public object key is the SHA-256 of its own derivative bytes (`public-media/sha256/<hh>/<hash>`). The key *is* the digest, so an object cannot be silently altered in place — mutation changes the key. Exact-byte dedup is a `HEAD` before `PUT`. The vault stays on **opaque ULID keys** — content-addressing there would create a deanonymization existence oracle (anyone holding a copy of an original could confirm we hold it).

**2. Probation before any lock or replica (the critical fix).** A newly-admitted object is **fully deletable** during a mandatory **probation/challenge window (30–90d, counsel-set)**, during which it is continuously re-scanned against rolling CSAM-hash lists, known-bad pHashes, and updated lexicons, and is open to dispute. Bucket Locks and off-Cloudflare replication apply **only after probation clears** — because immutability applied before certainty turns any detection miss into permanently un-purgeable illegal content or a permanently-exposed victim.

**3. Bucket Locks — bounded, never indefinite, always purge-overridable.** After probation, R2 Bucket Locks (native retention, not S3 Object Lock) give operator-resistant, compulsion-resistant immutability against a *rogue admin quietly deleting*.

| Bucket | Lock | Duration |
|---|---|---|
| `evidence-vault` (ciphertext) | Retention, **fixed-duration, extendable** (e.g. 10 yr, extend under legal hold) — **not indefinite** | Long |
| `public-media` (derivatives) | Retention, fixed-duration rolling (e.g. 10 yr) | Long |
| `knowledge` (docs/bundles) | Short or none | 1–2 yr |

A **multi-party, logged short-purge override authority supersedes every lock and replica for illegal content or a legitimate erasure order.** This is the governing invariant *above* deletion-resistance: "immutable from day 0" and "can always purge CSAM" are mutually exclusive — we choose purgeability. Legal review must confirm that self-imposed inability to remove illegal content is not itself an exposure.

**4. Independent off-Cloudflare replication (v1: one target, human-gated for people-bearing).** Bucket Locks defend within Cloudflare; they do not defend against account termination or a Cloudflare-level order. So durable = exists in ≥2 trust domains. v1 replication is deliberately minimal:

- **Signed BagIt export packs → ONE off-Cloudflare S3-compatible store** (different jurisdiction, its own object-lock). Packs carry the public derivatives (or their hashes), a custody-chain slice with **per-item timestamps stripped/coarsened**, the covering Merkle root, and an aggregate provenance *status* — **never keys, never per-contributor signing material, never raw sensor bundles** (those are cross-item linkable). Egress from R2 is free; the second store's volume is small.
- **IPFS: manifests and Merkle roots only** — never the whole archive (commercial pinning ≈10× R2 and unbounded), and **never people-bearing derivatives** (a CID is self-perpetuating and unrecallable; one missed face becomes a permanent global exposure that "de-list from display" cannot reach). IPFS/partner mirroring of any people-bearing bytes is a **later, human-attested, highest-bar, one-way** step — documented verbatim as irreversible.

### Tamper-evidence (alteration/deletion detectable, even against us)

- **Per-object SHA-256** = the public key (any change is visible).
- **Append-only custody hash-chain** (per item, in a Durable Object): each event (`ingest`, `redact`, `admit`, `probation-clear`, `lock`, `replicate`, `dispute`, `tombstone`) records `record_hash = SHA256(prev_hash ‖ canonical(record))`. Schema is fixed and carries **no deanonymizing fields** (no IP, no device, no real name; actor = pseudonymous role/band only).
- **Batched, jittered Merkle checkpoints → OpenTimestamps (primary).** A daily-minimum, **coarse, jittered** signed Merkle root is anchored to **OpenTimestamps** (Bitcoin-anchored, free, jurisdiction-independent); Rekor optional/secondary. **Never hourly, never per-ingest, never per-item timestamps externally** — that is a contributor-deanonymization timing oracle against singleton submitters. An item enters a checkpoint only after it joins a cohort ≥K or a randomized delay elapses (reuse the §7.3 low-popularity cohort guard for checkpoint inclusion). Only **roots** leave Cloudflare.
- A **static inclusion-proof verifier** in the public archive lets any third party check an object's hash → custody record → Merkle path → external anchor, without trusting Harborage.

### Storage optimization (eat R2 no more than extremely necessary), integrity intact

The ordered levers, with a concrete national-protest-day estimate. Reference load: 50,000 submissions ≈ **897 GB** for one copy; naïve "store every original + a derivative" ≈ **1.8 TB/day** — the number to beat.

**Lever 1 — Deduplication (the dominant lever, and the real point).**
- **Exact-byte dedup is the ONLY thing that collapses storage.** Key = `original_sha256` (client-computed). Identical bytes → one stored object + N lightweight provenance rows in D1.
- **Perceptual clustering never deletes anything.** pHash (PDQ/dHash images, keyframe-sequence + TMK/PDQF video, Chromaprint audio) is *presentation/corroboration only* — it groups reposts of one clip under one incident for display, and a reviewer can split a cluster. Two different-angle videos of the same event are **distinct evidence**; keying keep/discard on a perceptual cluster would destroy the second angle. **Rule: exact-byte dedup deduplicates storage; perceptual dedup deduplicates presentation.**
- **Privacy-safe existence check:** reuse the §7.3 low-popularity guard verbatim — popular content returns "already held, just corroborate"; obscure/singleton content gets no existence oracle and is reconciled server-side after a jittered upload.
- **Dedup sensitivity, stated honestly:** repost-heavy virality suggests high duplication, but a *documentation* archive invites original footage, so we model a **conservative 40–85% range**. At 85%: ~135 GB unique/day. At 40–50%: several× larger — still cheap in R2. **Dedup's primary value is cutting COMPUTE and moderation-queue volume** (we transcode/verify the unique set, not all 50k submissions), not saving trivial storage dollars.

**Lever 2 — Transcode derivatives (unique set only; never the pristine original).** Target evidence-legibility (read a badge/banner/plate; faces already redacted), not broadcast masters.
- **Images:** `env.IMAGES` binding → **AVIF** q≈50–58, long-edge ≤1600–2048px (20 MB input ceiling; oversized/RAW → Container). ~4 MB JPEG → ~180–300 KB. One AVIF master; `format=auto` handles WebP fallback at serve time.
- **Video:** Cloudflare Container (ffmpeg) → a **fast, cheap codec for v1 — H.264 high or VP9, or SVT-AV1 at a FAST preset (~8–10), not preset 6.** ≤720p, ≤30 fps, Opus audio, redundant streams stripped. **No per-view fallback re-encode** — store one derivative, serve it directly (free egress), cache poster frames. AV1 at slow presets is deferred to an optional *batch* cold re-encode if storage ever bites — Container CPU-seconds, not storage, is the real budget line.
- **Audio:** Opus 24–48 kbps mono (speech).

**Lever 3 — On-demand variants, not stored.** One master per media; thumbnails/tiles/low-bandwidth variants via Images URL transforms + edge cache. Free egress + per-month transform dedup makes this near-free.

**Lever 4 — Original-retention (integrity-preserving).** Keep **one pristine original per exact-unique admitted media, always.** Admission already requires Verified, so **never discard the pristine original of an admitted item** — an obscure singleton can be the only record of a killing years later, and "re-request from the pseudonymous submitter" is fantasy that defeats requirement #1. Given near-free vault storage, **default to keeping all non-radioactive pristine originals.** Only radioactive/never-admitted content short-purges (already handled). The `original_sha256` is retained in D1 **forever**, even for purged radioactive items (as a non-content audit row).

**Deferred from v1 (add later, measured):** Standard→IA tiering (30% of a tiny bill, adds retrieval-fee surprises on hot reads + lock/lifecycle interaction), compress-then-encrypt (2–8% gain, costs CPU on the low-end devices we protect), canonical-content-ID normalization.

**Integrity is never traded for size.** Each object row: `original_sha256` (the sole integrity anchor, always kept), `derivative_sha256` (its own hash), `derives_from = original_sha256`, and a **version-pinned `transform_recipe`** so an expert can reproduce the lossy-but-honest rendering. The §63 BSA attestation certifies the *pristine original's* hash; the derivative carries its own hash and a "derived-from" link. `canonical_content_id`, if used, is a **best-effort dedup HINT with pinned tool version — never an integrity anchor** (ffmpeg/libvips output drifts across builds).

**Net protest-day (85% dedup illustration):** ~14 GB public derivatives + ~39 GB deduped vault ciphertext ≈ **~53 GB new/day**. Roughly **250 GB/month → ~$3.75/mo**; a full year ≈ 3 TB ≈ **~$45/mo**, egress $0. Storage is a rounding error against the $100+/mo budget. **The binding costs are Container transcode compute and the moderation queue — both cut proportionally by dedup — which is why dedup is justified on compute, not storage.**

### Community contribution on all fronts (autonomous-first pipeline)

Contribution flows are typed, signed, blind-token-carried, reputation-weighted; none is trusted alone. Each attaches to a `cluster_id`/`harb_id`, never keyed to identity.

| Front | Action | Effect |
|---|---|---|
| Submit media | `SUBMIT_MEDIA` | Vault original + candidate derivative (on-device redaction confirm) |
| Submit link | `SUBMIT_LINK` | Arms-length off-platform fetch (Tor, pooled, no per-user log); redacted derivative admitted, pristine third-party bytes sealed in vault only |
| Corroborate | `CORROBORATE` | Adds *distinct provenance* to independence score |
| Verify | `VERIFY` | Weighted vote into state machine (never sole basis) |
| Geolocate / OSINT | `GEOLOCATE`, `CHRONOLOCATE` | Structured claim + evidence hash; independent agreement = strong signal |
| Transcribe / Translate | `TRANSCRIBE`, `TRANSLATE` | Versioned text layers; machine translation flagged advisory; safety-critical strings human-reviewed |
| Tag | `TAG` | Controlled taxonomy (no free-text PII into public fields) |
| Context | `CONTEXT_NOTE` | Community-notes-style, append-only, helpfulness-rated |
| Redaction review | `REDACT_CONFIRM` | Fail-closed gate for people-bearing third-party media |

**Autonomous-first, human for the irreversible step.** Display/corroboration/verification signals run autonomously (AI + community + reputation) so the honest human-review bottleneck doesn't gate throughput. But the **irreversible steps — external "Verified", lock, and any mirroring — require explicit human sign-off** plus a settling period and a raised corroboration threshold K against a resourced Sybil adversary. Reputation is carried by **blind tokens / anonymous credentials** (server holds no roster); a contribution presents `{band proof, one-time nullifier}` — the nullifier stops double-counting without revealing or linking identity. There is no contributor→item edge table, no co-witness graph, no identity↔pseudonym map.

### Anti-poisoning + correction/retraction (append-only, tamper-evident)

A state adversary planting a convincing fake that reaches "Verified" is the primary threat, and durability must not make a wrong entry permanent.

- **Recycled/repost & known-debunked detection** — pHash BK-tree flags resubmitted-as-new and auto-DISPUTEs known-debunked hashes.
- **Deepfake/synthetic — advisory only** (`low/medium/high`); never auto-rejects or auto-admits; "high" forces extra corroboration + human review.
- **Metadata/chronolocation consistency** — EXIF vs claimed time/place, sun/shadow, weather; inconsistency requires reconciliation before promotion.
- **Independent multi-source corroboration** — K=2 with valid C2PA/ProofMode provenance, K=3 for provenance-less imports, plus ≥2 distinct provenance origins. **Independence is scored, not graphed;** coordinated-timing/identical-payload bursts down-weight to near-zero and route to human review.
- **External status is short-lived and revocable.** A durable "Verified" is **never** emitted into a mirror/export on the autonomous path. Exported status is a **short-lived signed assertion consumers must re-check against a live revocation feed**; bundles are versioned and re-signed on demotion. Framing: "community-corroborated, preservation — not authentication."
- **Correction/retraction is append-only supersede, never erase.** `disputes` is append-only; Verified→Disputed→Debunked demotes and de-amplifies. On Debunked the derivative is withdrawn from *local* display, but the tamper-evident record that it existed and was retracted **remains public** — a planted item's takedown is itself documented. For anything already mirrored, docs state verbatim that de-list is **local-only** (which is exactly why mirroring is the last, human-gated step). Radioactive content is the sole exception where payload does not persist (short-purge).

### Provenance & open-documentation export (no deanonymization, no sealed leak)

- **Citable stable ID** — `HRB-<base32(SHA-256(original_bytes)[:10])>`, deterministic and re-derivable by re-hashing the pristine original; a `-vNN` suffix versions the derivative/annotation without changing evidentiary identity.
- **Per-item provenance surfaced** — `original_sha256`, C2PA/ProofMode status (validated internally, shown as `valid/invalid/absent`), capture-time + confidence, verification label, independent-source count, custody checkpoint root. **Absence of provenance shown neutral, never as guilt.**
- **Machine-readable schema** — JSON-LD extending schema.org `ClaimReview` + a `harborage:EvidenceItem` vocabulary. Contributions represented only as `{opaque_token, reputation_band, type}` — **no contributor pubkeys, no per-device signing keys, no raw sensor bundles** (all cross-item linkable).
- **Signed export bundles** — `.harbex`/BagIt packs, Ed25519/minisign-signed by an offline m-of-n project key, written immutably to `knowledge`. Every field audited for cross-item linkage before it ships; per-item timestamps coarsened. Sealed vault data and contributor identity are **structurally absent** from every export path — you cannot leak what the export layer cannot read.
- **Read-only public API** (Worker), rate-limited, no auth for public data, **no query surface that could enumerate contributors or correlate compartments.**

### Confidentiality posture — stated as a new risk class

The permanent public archive **inverts** the platform's baseline "minimize retention / can't produce plaintext" posture, which is now scoped to **the vault only**. The public corpus is a **distinct, new risk class** whose safety rests on redaction + radioactive-classification recall against an evasive adversary — a probabilistic gate, not a guarantee. This is why permanence is earned per item by human attestation after probation, and why the purge-override supersedes every lock. The plaintext pHash / dedup index in D1 is **scoped to the public-admitted derivative set only** — fingerprints of SEALED_ONLY vault originals are **never** placed in compellable plaintext D1 (that would be a content-existence oracle over "unreadable" content). Honesty throughout: **"preservation supporting lawful processes, not an admissibility guarantee."**

### Ruthless v1 scope (Session-3) vs. later

**v1:** content-addressed public keys + exact-byte dedup (HEAD-before-PUT behind the §7.3 cohort/delay guard); image derivatives via `env.IMAGES` AVIF, video via Container with a cheap fast codec; probation window; fixed-duration Bucket Locks on both buckets (post-probation) + purge-override; ONE replication target (signed BagIt packs → one S3 store with object-lock, roots/manifests to IPFS); reuse §7.2 custody chain + daily jittered signed Merkle root anchored to OpenTimestamps; admission via §7.1 redaction + §7.4 Tier-0 + community verify; the eight contribution actions with blind-token weighting; append-only disputes.

**Later:** perceptual near-dup clustering at scale, Cloudflare Workflows orchestration, deepfake advisory, chronolocation, C2PA validation, whole-archive IPFS/Filecoin, partner human-rights custodian (Mnemonic/Syrian-Archive model), Rekor, IA tiering, AV1 batch cold re-encode, compress-then-encrypt.

---

## 17. Infrastructure as Code & Operations (IaC)

Modeled on the proven pattern in the reference app `madian/v2`. Governing rule: **anything that can be code is code; only what genuinely needs a human is in [RUNBOOK.md](./RUNBOOK.md).** Anything mutated outside the repo is unrecorded drift.

### 17.1 Tooling & state
- **OpenTofu** (`tofu`, **≥1.12** — 1.11.x is EOL 2026-08-01) + **Cloudflare provider `~> 5.22`**. State in **R2** via the Terraform `s3` backend with `use_lockfile = true` (native state locking, no DynamoDB). `backend.hcl` is gitignored and rendered inline in CI; state-bucket auth is **R2 bucket-scoped keys** passed as `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` — separate from the Cloudflare API token.
- **Wrangler v4** deploys the Worker(s). One state-bucket bootstrap exception: `wrangler r2 bucket create harborage-tfstate` before Tofu exists.

### 17.2 One writer per resource — the Terraform / Wrangler split
OpenTofu owns account/zone resources; Wrangler owns the Worker and its bindings. Never two writers on one hostname.

| Resource | OpenTofu (`infra/*.tf`) creates | Wrangler (`wrangler.jsonc`) binds/owns |
|---|---|---|
| D1 | the database | `d1_databases` binding (ID via CI `sed`); migrations via `wrangler d1 migrations apply --remote` |
| R2 (vault / public-media / knowledge / archive / tfstate) | each `cloudflare_r2_bucket` + lifecycle + Bucket Locks (post-probation) | `r2_buckets` bindings by name |
| KV (incl. `FLAGS`) | each namespace | `kv_namespaces` binding (ID via CI `sed`) |
| Durable Objects | — | wrangler entirely: DO class bindings + `new_sqlite_classes` migrations |
| Queues | `cloudflare_queue` (in state) | producer/consumer bindings |
| Vectorize | — (`wrangler vectorize create` in bootstrap) | index binding |
| Workers AI + AI Gateway | `cloudflare_ai_gateway` (rate limits, logging, caching) | `ai` binding; route model calls through the gateway |
| Turnstile (per sensitive surface) | `cloudflare_turnstile_widget` | sitekey via build env; secret via `wrangler secret put` |
| Cloudflare Access (privileged console) | org + IdP + policy + `access_application` (destinations = `/console*`, privileged API paths) | worker-side `jose` JWT re-verify (fail-closed) |
| WAF / rate-limiting | `cloudflare_ruleset` (`http_ratelimit`, `http_request_firewall_custom`) | plus app-level RateLimit DO per sensitive endpoint |
| Email | Email Routing rules + MX/DKIM/DMARC/SPF DNS (`prevent_destroy`) | `send_email` binding |
| DNS / zone | everything **except** worker hostnames | apex/route hostnames via `routes … custom_domain: true` |

`REPLACE_*` placeholders in `wrangler.jsonc` (D1 id, KV id, Access AUD, team domain, Turnstile sitekey) are injected in CI from `tofu output`. Never hardcode them. Mirror all bindings in a `worker-lib/types.ts` `Env` interface as the authoritative source of truth. Put `prevent_destroy` on anything whose loss is catastrophic (Email records, the Access application, the signing-key config).

### 17.3 Deprivileged CI (the key security pattern)
Two GitHub Actions workflows, `permissions: contents: read`, all actions pinned to full commit SHAs, deploys **CI-only** (no laptop deploys).
- **`ci.yml`** (PR): install `--frozen-lockfile` → typecheck → build → **CI-as-enforcement gates** (§17.5) → `tofu plan` (shows the infra diff on every PR).
- **`deploy.yml`** (push:main): job **`infra`** holds `HB_TERRAFORM_TOKEN`, runs `tofu apply`, exports resource IDs as outputs → job **`deploy`** (`needs: infra`) that **never receives the Terraform token** — it holds only the R2 state creds and the quarterly-rotated `HB_DEPLOY_TOKEN`, reads sensitive outputs from state with `tofu output -raw` + `::add-mask::`, `sed`s the wrangler config, deploys the Worker, runs `wrangler secret put`, applies D1 migrations, and smoke-tests (asserts `/console` is never 200 without Access). A protected GitHub `production` **environment** (required reviewer) is the whole approval surface; a shared `concurrency` group serializes Tofu.

The token that can rewrite DNS and Access never enters the job that runs third-party (`pnpm`-installed) code.

### 17.4 Kill switches, secrets, signing keys
- **Kill-switch flags are runtime data, not IaC and not `wrangler vars`** (a var flip needs a redeploy — too slow to stop a live incident). Terraform creates the `FLAGS` KV namespace; the **FlagState DO** is the strongly-consistent source of truth with an append-only audit log (§10.3), fronted by a short-TTL KV/per-colo cache. Every high-risk feature reads its flag and **fails closed by default** (absent/unreachable ⇒ feature off). Flags are flipped instantly from the **Access-gated `/console`**, never through the deploy pipeline; heightened-threat is one composite flip.
- **Runtime secrets** (Turnstile secret, API tokens, HMAC peppers) → GitHub Environment secrets → `wrangler secret put` in the deploy job. Never in the repo (`.dev.vars`, `.env*`, `backend.hcl`, `terraform.tfvars` all gitignored).
- **Signing keys generated offline never enter CI or Terraform.** Only the *public* verification key ships (committed / wrangler var). Private keys live in an offline vault, used only during the m-of-n ceremony (RUNBOOK).
- **No auth-bypass code path ever ships.** Do not port `madian`'s `ADMIN_DEV_BYPASS` / `DEV_FAKE_AI` escape hatches — use a local mock Access issuer so there is no bypass that could reach production.

### 17.5 CI-as-enforcement gates (encode invariants as build gates, not review etiquette)
The build **fails** if any of these trip:
- **No-AI-tells / plain-language gate** — reject the banned copy patterns (em-dash `U+2014` in shipped UI strings, the CLAUDE.md ban list) in built output and message catalogs.
- **Strict CSP + Trusted Types gate** — nonce-based CSP (no inline/eval), `Trusted Types`, security-header baseline enforced in the web Worker and verified in CI (hash the SvelteKit bundle + any inline theme/FOUC script). For a browser-crypto PWA an XSS equals the top-tier code-injection threat; Svelte auto-escaping is not sufficient.
- **`safeLog` gate** — lint bans raw `console.*`; assert sensitive field names never appear at call sites.
- **Memory-only invariant test** — fails if LiveBoard/Broker/RateLimit/CIB/VerificationState hot-path code writes signal/location/timing/token→identity/pubkey fields to DO SQLite or D1.
- **Sensitive-write-must-be-sealed test** — the intake Worker rejects any non-sealed body on a sensitive endpoint.
- **Supply chain** — actions SHA-pinned (zizmor/ratchet), `--frozen-lockfile`, lifecycle scripts allow-listed, `harden-runner` egress-block, secret scanning + push protection, Dependabot never auto-merged, signed commits on `main`.

### 17.6 DDoS, rate-limits, anti-replay, PWA cache safety
- **Volumetric L7 DDoS** relies on Cloudflare's managed/unmetered rulesets; WAF custom-characteristic rate-limiting needs Business+, so the **RateLimit DO is the deliberate app-layer substitute** (per-cap-cert / per-ASN-bucket / global token buckets). Never rate-limit *reading* public safety info.
- **PoP anti-replay:** per-request proof-of-possession binds a server-issued challenge or short-window timestamp + nonce; the api Worker rejects stale/seen nonces (bounded in the RateLimit/CIB memory DO).
- **Service worker never caches privileged/console or sensitive responses** (`no-store`, excluded from the precache manifest). Locally cached data is sensitive-at-rest; panic/safe-mode clears caches + IndexedDB. Analytics default **off** on sensitive routes; no IP hash / no geo for at-risk users; the beacon never fires on privileged paths.

### 17.7 Coordinated disclosure, incident response, warrant canary
- **Coordinated disclosure + safe harbor:** publish `/.well-known/security.txt`; encrypted **identity-optional** intake (PGP/age or an onion drop, not email). De-anonymization / redaction-bypass / code-injection bugs are **P0** with an embargoed window; a sensitive field reaching logs is Sev-1. Stated safe-harbor commitment.
- **Incident-response / continuity runbook** ([RUNBOOK.md](./RUNBOOK.md) Part C): (a) signing-key compromise → revocation epoch bump + peer-QR propagation (§5.5) + re-key ceremony; (b) breach → user notification via a **signed Official Notice** (§4.2) + canary shift (there is no directory/push/email channel); (c) forced takedown → non-CF mirror + fork continuity.
- **Warrant canary:** human-produced, offline-minisign-signed, published to `/.well-known/canary.txt` with a hard expiry; signing stays manual/offline by design (automating it would let a compelled Cloudflare keep it alive). Missing/expired signature *is* the signal.

### 17.8 Repo shape (monorepo)
`pnpm` workspace, `--frozen-lockfile`, `engine-strict`. `apps/web` (SvelteKit PWA) + `apps/console` (Access-gated) · `packages/foundry` (CSS-token design system, §18) · `packages/worker-lib` (`access.ts` fail-closed JWT, `turnstile.ts`, `flags.ts`, crypto module, `types.ts` Env) · `infra/` (OpenTofu) · `migrations/` (D1 SQL) · `scripts/bootstrap.sh` (near-zero-manual bootstrap) · `.github/workflows/`. See [RUNBOOK.md](./RUNBOOK.md) for the minimal manual surface.

---

## 18. Final Pre-Build Reconciliation, M0 Manifest & Freshness (Session 2.6)

A final solidity pass confirmed the plan **only grew** — no capability was dropped, no primitive downgraded. This section is the authoritative reconciliation for the build: **where earlier sections conflict with this one, this one wins.** It exists because the Session-2.5 layer was added on top of §1–13 rather than rewriting it, so some older text still describes the pre-pivot system.

### 18.1 Reconciliations (these override earlier text)

- **The AI + community trust engine is DAY-1 CORE, not deferred.** Every "deferred / optional / AI = later" statement (§2 row 11, §3.1 diagram, §4.4, §7.4, §12 M5) is superseded by §15. What is deferred is **scale/tuning**, never the engine. Build order for it: the **trust floor** (default `Unverified`, chronological, never amplified, + Tier-0 tripwires + hide-pending + human-console queue) at **M2**; the **corroboration-reach machinery** (Community-Corroborated up-ranking, √-damped reputation, CIB, cohort-pivot) at **M3**, tuned against live abuse + a load harness. The AI resources (AI Gateway, Workers AI, Vectorize, `SpendCapDO`) are **provisioned day-1 but flag-gated** behind the spend-cap + degrade ladder. Safety lives in the floor, so this loses nothing.
- **Public verification labels are the four plain words only** (PRD §15 is the UX authority): "Verified by our team" / "Confirmed by people nearby" / "Not checked yet" / "Reported as a problem". The internal 8-state machine (§15) maps to them: `Human-Verified`→team; `Community-Corroborated`→people nearby; `Unverified`/`AI-Screened`→not checked yet; `Disputed`/`Debunked`→reported/hidden. **No "AI-checked" string ever reaches a user;** the honest "automated, can be wrong" wording lives on tap-through only. Delete "AI-checked (automated)" from every public badge (this corrects §15 and the CLAUDE Trust & Safety block).
- **Verification vocabulary:** the old 5-state list (PRD §2, §6) is replaced by a pointer to the §15 canonical machine. Correct "Verified travels with every incident" → the autonomous ceiling is `Community-Corroborated`; only human review confers `Human-Verified`.
- **Moderation posture (inline, not just the banner):** reversible moderation (label / rank / hide-pending / retain-pending) is **autonomous day-1** (§15). The human org is a **hardening** milestone; only the irreversible m-of-n gates (individual naming, unredaction, precise-location reveal, permanent deletion) need it and ship **OFF**. This corrects "a human decides every removal/verify" in PRD §6/§4.11/§8/§11 and ARCH §11 row 13.
- **Redaction wording:** the tool is **"cover / solid box"** — irreversible solid-fill. The word **"blur" is banned** in all user copy and docs (blur is partly reversible). Fix every "blur" in UX copy to "cover".
- **Facilities are `PUBLIC_INFRA` rows in `resource_entries`** (PRD §14), served from the Cron-materialized directory rollup. Drop the separate "FacilitiesDO/D1" in §6.1; the only retained live-board invariant is **physical segregation from density signals**. Restore the in-action path: a **"Facilities near me"** surface on the **Nearby** tab (coarse-geo `PUBLIC_INFRA` query, ≤2 taps) so a protestor mid-action still finds toilets/water/charging fast.
- **R2 = 3 content buckets + 1 state bucket:** `evidence-vault`, `public-media`, `knowledge`, plus `harborage-tfstate`. There is **no 4th `archive` bucket** — archive derivatives live in `public-media`, sealed originals in `evidence-vault` (§16). Corrects §17.2.
- **One name for the CIB Durable Object:** `CoordinationWindowDO` everywhere (corrects "CIB window" in §3.2/§10.3/§17.5/CLAUDE).
- **Memory-only CI gate is two gates** (§17.5): *wholly-memory classes* (no `ctx.storage` write at all: LiveBoard, Broker, RateLimit, CoordinationWindow) vs *field-forbidden classes* (`VerificationStateDO` is SQLite but must never store signal/location/timing/token→identity/pubkey fields).
- **No user-facing email path (invariant guard).** Cloudflare Email Sending is operator/console-side only. Auth, recovery, and user notifications must **never** use email — that would breach the no-email / no-member-directory / content-free-notification invariants. Corrects the §14 Email bullet.
- **Personas:** add **seeker** (incl. students, persons with disabilities), **volunteer/curator**, **provider/org** to PRD §3 (they were modeled in §14 but missing from the §3 table). All are client-held lenses, zero-account browse, no role registry.
- **Duress/decoy** (BIP39 passphrase → decoy tree, §5.2) gets an explicit Settings → safe-mode entry in the UX so it is not silently dropped at build.

### 18.2 Build-vs-switch-on (removes all Session-3 scope ambiguity)

Session 3 **builds the full milestone code behind fail-closed flags.** The human/legal gates (offshore entity, counsel sign-off, offline key ceremony, crypto audit, staffed human org, off-platform custodians) govern only the **flip**, never the build. So every milestone row has two gates: *buildable now* (always yes for the code) and *blocks switch-on* (the human/legal gate). A builder is never blocked from writing a feature; they are blocked only from turning it on.

### 18.3 M0 Resource Manifest (the first Session-3 deliverable — before code)

Author this table first; it drives `wrangler.jsonc`, `infra/*.tf`, and a `worker-lib/types.ts` `Env` that matches 1:1.

- **Durable Objects:** `LiveBoard` (memory), `Broker`/`Mailbox` (memory + R2 ciphertext), `RateLimit` (memory), `CoordinationWindow` (memory, CIB), `FlagState` (SQLite, audit), `NoticeLog` (SQLite, hash-chain), `ReviewGate` (SQLite), `DeadlineTimer` (SQLite, alarms), `VerificationState` (SQLite, field-forbidden), `SpendCap` (SQLite, Neuron counter), `ReReviewQueue` (SQLite), `CustodyChain` (SQLite, archive hash-chain), `CurationCoordinator` (SQLite, directory triage). Wrangler owns all DO bindings + `new_sqlite_classes` migrations.
- **D1 tables** (single DB, every filter column indexed): `incidents`, `evidence_refs`, `verification_states`, `accountability_records`, `legal_matter_refs`, `notices`, `notice_chain`, `key_directory`, `revocation_list`, `reputation_scalars`, `perceptual_hashes` (public-derivative only), `resource_entries` (DIR-1/DIR-2 columns absent by design), `skills_registry` (brokered helpers — **not browsable**), `archive_items`, `archive_provenance`, `archive_disputes`, `feature_flag_audit`, `mod_audit`. No member/user table, no social/vouch graph, no who-was-where table.
- **R2:** `evidence-vault`, `public-media`, `knowledge` (+ `harborage-tfstate`).
- **KV:** `FLAGS`, `CONFIG`, `I18N`, `RULESETS`, `KEYDIR_CACHE`.
- **Queues:** `moderation-bulk` (+ DLQ), `life-safety` (reserved concurrency, + DLQ).
- **Vectorize:** one index, `embeddinggemma-300m` 768-dim (immutable at creation).

### 18.4 Freshness updates (re-verified today; §14 remains otherwise accurate)

- **OpenTofu ≥ 1.12** (1.11.x EOL 2026-08-01 — inside the build window). §17.1.
- **Cloudflare Terraform provider `~> 5.22`** (pin the minor). §17.1.
- **`shamir-secret-sharing` (privy) → `0.0.4`** (exact pin, not `latest`). §14.
- **`@inlang/paraglide-js` 2.22.0** (caret `^2.20.x` unchanged; note bump). §14.
- **OpenTimestamps (the one genuine unpinned hole):** `opentimestamps@0.4.9` is ~5 yr old / unmaintained. Either pin it with a "builds under Vite 8 / Node 22 ESM" CI gate, adopt the maintained `@lacrypta/typescript-opentimestamps`, or mark archive OTS-anchoring **build-vs-defer**. Add to §14 pins + §16.
- **New Cloudflare capabilities to adopt** (all confirmed GA, currently under-used): **Access Independent MFA** with `security_key` **AAGUID-restricted** to project-issued authenticators on `/console*` (§9.5, §17.2); **DO Memory-Usage metrics** — alarm on `memoryUsageBytesP99` per memory-only DO + a byte-threshold shard-out trigger (memory-only DOs can hit silent `Exceeded Memory` at surge) (§3.2, §10.5); **Queues `metrics()`** — the life-safety queue pages the operator when `oldestMessageTimestamp` exceeds N seconds (§3.1); **Container active-CPU-second billing + custom instance types** — transcode/pHash is materially cheaper than the prior estimate; size a custom instance rather than over-provisioning (§16).
- **Precision notes:** AI Gateway Guardrails — soften "GA; Hindi supported" to "available; confirm GA + hi coverage at switch-on; the Tier-0 floor does not depend on it." Queues 5,000 msg/s is the **pull-consumer** ceiling; size the protest-day drain off **250 push-concurrency × batch**. `llama-guard-3-8b` is still current (no Llama-Guard-4). Keep Capacitor 8 (9 is alpha).

### 18.5 Gaps to close in Session 3 (P1 before bulk code, P2 soon)

- **P1 — M0 resource manifest** (§18.3) authored first. **P1 — seed-content pipeline:** `content/{directives,kyr,crisis-cards,directory-seed}/` source format, two-person review record, **named human owners** (legal reviewer, medic reviewer, en/hi translators, m-of-n signers), and the signed `.harborage-pack` build step — without these, M1 ships a shell with nothing to sign. **P1 — D1 backup/DR:** periodic **signed export of public-plaintext tables** → `knowledge` bucket + non-CF mirror + a restore-into-fresh-account procedure (account termination is a named threat; E2E/off-platform classes excluded by construction). **P1 — foundry design-token package** (`packages/foundry`): `tokens.css` + build + an AA-contrast CI gate, consumed by `apps/web` + `apps/console` (repoint §17.8 to PRD §15 tokens).
- **P2** — trust-engine conformance tests (state machine, Sybil/CIB simulation, reach-table conformance, "flag-storm can't bury truth", "mob can't cheaply verify", and a guard that the fixed action-enum has no code path to publish/delete/unredact/name); a **pixel-level test that the public derivative never contains the vault original's bytes**; a **protest-day load harness** (k6/artillery for LiveBoard HLL ingest, Queue drain under surge, SpendCap under flood); a **privacy-safe war-room dashboard** (queue backlog, SpendCap %, error rate, DO P99 memory, per-colo flag-flip latency) via Analytics Engine aggregate counts only — no per-identity/IP/geo; a concrete **Capacitor APK milestone before M3** (M3 capture tier + M5 reviewer naming depend on it); Paraglide 2.x inlang layout + the no-AI-tells ICU gate + "safety strings never machine-translated, named-reviewer record" enforcement; document the native-R2-presign fallback for maintenance-mode `aws4fetch`.
