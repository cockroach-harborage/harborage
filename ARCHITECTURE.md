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

**Fingerprint-and-reference, never re-host by default** (copyright / IT-Act conduit exposure). Store canonical content-ID + perceptual hash; any evidentiary copy goes to the sealed vault only. **Perceptual hashing cannot run in a Worker** (no image/video decode, 128 MB, CPU limits) — so:
- Fingerprints for imported links are computed on the **off-platform arms-length fetch box** (the same egress Decision 14 needs), which fetches over Tor, pooled/deduped by content-ID, **no per-user fetch log.**
- **Low-popularity URLs get a deliberate delay + minimum-cohort threshold** before fetch (or skip fetch and store only the user-supplied content-ID/pHash) — dedup only anonymizes *popular* content; an obscure single-referrer URL is otherwise ~1:1 time-correlated to the submitter.
- pHash near-dup matching lives in a **BK-tree / banded LSH** structure (Hamming distance), **not Vectorize.**

### 7.4 AI-assisted human-in-the-loop moderation

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

All 13 domains are *architected*; they are **not all built for v1**. A volunteer team ships a coherent core sequenced behind the legal/organizational critical path. **Each data-holding milestone is gated on BOTH its counsel interlock AND the existence of the human org that operates it.**

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
