# RUNBOOK.md — Harborage

Manual steps only. **Anything that can be code is code** (OpenTofu / Wrangler / CI — see [ARCHITECTURE.md §17](./ARCHITECTURE.md)). A step is here only because a human genuinely must do it. Anything mutated outside the repo is unrecorded drift; if you do a manual write, record it here in the same PR.

The whole manual surface is small: mint tokens, click a few one-time dashboard activations, run one offline key ceremony, run one bootstrap script, read one plan, approve the deploy. Everything recurring is "edit a GitHub var/secret and re-run the workflow."

---

## Part A — One-time bootstrap (ordered)

Click-by-click values and the exact dashboard strings for every step below live in [docs/bootstrap-walkthrough.md](./docs/bootstrap-walkthrough.md). This list stays terse; anything runnable is already in `scripts/` — the human surface is dashboard clicks, token minting, the plan gate, and the deploy approval.

0. **Add the production domain as a Cloudflare zone.** The domain is `cockroachharborage.org` (registered 2026-07-22). If it was bought via Cloudflare Registrar the zone already exists; otherwise add the site in the dashboard and point the registrar's nameservers at Cloudflare. The zone name is supplied to IaC via `terraform.tfvars` (gitignored) — never hardcoded. *(GitHub remote: `cockroach-harborage/harborage`, created in Session 3 via `gh repo create`; branch protection + `production` environment are applied by script, recorded here because repo creation itself is a one-time act.)*

1. **Mint scoped Cloudflare API tokens in the dashboard** (My Profile → API Tokens → Create Custom Token) — the API cannot self-bootstrap tokens. Create three, scoped by blast radius and least-privilege (exact permission-group names + scope/level in the [walkthrough §1](./docs/bootstrap-walkthrough.md#step-1)):
   - `HB_TERRAFORM_TOKEN` (CI `infra` job only) — Account: `Access: Apps and Policies`, `Access: Organizations, Identity Providers, and Groups`, `Workers R2 Storage`, `Workers KV Storage`, `D1`, `Queues`, `AI Gateway`, `Vectorize` (the index is created by `bootstrap.sh` via wrangler, not tofu); Zone: `DNS`, `Zone Settings`, `Zone` (Read) — all Edit, scoped to the one account / `cockroachharborage.org`. **Turnstile / Zone WAF / Email-Routing permissions are added when their `tofu` resource lands** (then re-mint), not pre-scoped now.
   - `HB_DEPLOY_TOKEN` (CI `deploy` job only) — Account: `Workers Scripts`, `Workers KV Storage`, `D1` (Edit), `Account Settings` (Read); Zone: `Workers Routes` (Edit). **Not** `DNS`: Worker Custom Domains create the record + cert server-side, so add `DNS:Edit` only if a deploy 403s. `Queues`/`Workers R2 Storage`/`Workers AI` are added when a Worker actually binds them (M2/M4). **Rotate quarterly** (Part B).
   - Read-only worker tokens (e.g. analytics) — minimal scope, live inside the Worker so a compromised Worker can never deploy or edit DNS.
2. **One-time product activations in the dashboard** (dashboard-only): **Workers Paid** ($5/mo — Vectorize requires it; DO + Queues are on Free), **R2**, **Zero Trust / Access** (team `cockroach-harborage` → `cockroach-harborage.cloudflareaccess.com`, defaulted in `bootstrap.sh`), and the **`cockroach-harborage.workers.dev`** subdomain (cron triggers refuse to deploy without one even with `workers_dev:false`, which both Workers now set). Vectorize / AI Gateway / Queues need no extra click. **Email Routing stays off** — enabling it adds MX/SPF records that conflict with the null-SPF (`v=spf1 -all`) anti-spoofing posture; switch it on only when operator email is provisioned (adds `email.tf`).
3. **Mint the bucket-scoped R2 S3 keys for the Terraform state backend** (dashboard-only — R2 → Manage API tokens → `Object Read & Write`, scoped to `harborage-tfstate`; these are the sole IaC-can't-bootstrap-itself exception). The state bucket itself is created idempotently by `bootstrap.sh`; create it in the R2 dashboard first if you need it to exist to scope the key.
3b. **Turn on org-level Access Independent MFA (dashboard/API — org-scoped, can't be per-app tofu).** Zero Trust → Access controls → Access settings → Allow multi-factor authentication: set `allowed_authenticators = ["security_key","biometrics"]` (both WebAuthn, phishing-resistant; TOTP left off — note security-key-*only* is not selectable), an `Authentication duration`, and leave **Use identity provider MFA (AMR-matching) OFF** so the guarantee is not delegated to the GitHub IdP. After the offline key ceremony (step 5) yields the console admins' hardware keys, create an **AAGUID List** of those keys and set it as `required_aaguids` so only ceremony hardware can enroll (enrollment-time only). Then reconcile `infra/access.tf`'s policy `require` block against this org config (the `swk`/`hwk` caveat noted there). Verify by logging into `/console` and completing the WebAuthn prompt.
4. **`gh auth login`** (needs repo admin, to create the `production` environment + secrets).
5. **Offline key ceremony (MUST stay manual — security).** On an air-gapped machine, run the documented m-of-n ceremony to generate: the project release/knowledge-pack signing keys, the official-notice role keys, and the warrant-canary key. Commit/deploy **only the public keys**. Private keys go to the offline vault and never touch CI, Terraform, or Cloudflare.
6. **Run `bash scripts/bootstrap.sh`** — idempotent: verifies the tokens, resolves account/zone IDs, generates any server-side salts/peppers once (`openssl rand`), creates the state bucket if missing, `wrangler vectorize create`, creates the GitHub `production` environment and sets every secret + the `ADMIN_HANDLES` / `CF_ACCOUNT_ID` / `ZONE_NAME` / `IDP_GITHUB_CLIENT_ID` / `ACCESS_TEAM_DOMAIN` variables, snapshots current DNS, writes `backend.hcl` + `terraform.tfvars`, and finishes with `tofu init/validate/plan`. **It stops at the plan — it never applies.**
7. **Read the `tofu plan` (the human gate).** Any change or destroy on Email/DNS/Access/signing-key config is a bug: stop and investigate, never apply.
8. **Harden the repo, then push to `main`.** Run `bash scripts/setup-commit-signing.sh` (SSH commit signing + registers the signing key) and `bash scripts/github-setup.sh` (branch protection; re-run with `ENFORCE_SIGNATURES=1` once the signing key is registered). Push `main` → CI applies infra, then deploys. Approve the protected `production` environment when prompted.
9. First-deploy verification: `/` returns 200; `/console` is **never** 200 without Access; a signed knowledge pack verifies on-device; the warrant canary is live and signed.

---

## Part B — Rare recurring (mostly "edit a var/secret, re-run the workflow")

- **Quarterly API-token rotation (MUST stay manual — security):** create the replacement token → update the GitHub Environment secret → re-run deploy → revoke the old token. Order matters.
- **Warrant-canary (re)signing (MUST stay manual — offline key):** on schedule, sign the canary offline with the offline key, commit the signed artifact; CI only publishes it. A missing/expired signature is itself the signal — never automate the signing.
- **Production deploy approval (deliberate manual gate):** the `production` environment's required reviewer.
- **Add/remove a console admin:** edit `ADMIN_HANDLES`, re-run deploy.
- **Email verification / DKIM:** paste the verification TXT then DKIM records when the mailbox is provisioned; raise DMARC to `p=quarantine`.
- **Directory seed / founding-org sign pack:** import candidate resources into the Access-gated console queue, re-verify + re-capture consent, then sign into the seed pack. Never publish an imported entry unverified.

## Kill switches — neither code-deploy nor runbook

Per-feature kill switches and heightened-threat mode are **runtime data** flipped instantly from the Access-gated `/console` (backed by the FlagState DO + `FLAGS` KV; fail-closed by default). They are **not** a deploy and **not** a manual infra step — during a live crackdown you flip a flag in seconds, you do not push code. Irreversible / accountability-publication / detainee-intake toggles require 2-person authorization.

---

## Part C — Break-glass / incident response

- **Locked out of `/console`:** recover via the Access policy in `infra/access.tf` (edit `ADMIN_HANDLES`, re-apply) — there is no auth-bypass code path by design.
- **Signing-key compromise:** bump the revocation epoch, propagate revocation through peer QR/file packs, run a re-key ceremony (Part A step 5).
- **Data breach:** notify users via a **signed Official Notice** (there is no directory / push / email channel) and shift the canary.
- **Forced takedown / Cloudflare block:** serve from the non-Cloudflare public mirror; fork-continuity per the open-source governance plan.
- **Mail broken after a DNS change:** restore from the DNS snapshot taken in bootstrap; Email records carry `prevent_destroy`.
- **Debugging:** `wrangler tail` (no sensitive data is logged — see `safeLog`, ARCHITECTURE §10.5).

---

## M1 feature switch-on prerequisites

M1 code ships behind fail-closed flags (all OFF). The D1 migrations
(`incidents`, `evidence_refs`, `resource_entries`, `incident_public_index`) and the
`api`/`media` Workers deploy automatically; **switching a feature on** needs these
manual steps first (each is a readiness gate, not a code change):

- **`record_intake` (off-device evidence send).** (a) Mint a **bucket-scoped R2 S3
  API token** (Cloudflare API can't self-bootstrap it) and set `R2_ACCOUNT_ID`,
  `R2_PRESIGN_ACCESS_KEY_ID`, `R2_PRESIGN_SECRET_ACCESS_KEY` as `harborage-media`
  secrets (`wrangler secret put`). (b) Create the **Turnstile widget** and set
  `TURNSTILE_SECRET` on `harborage-api`; publish the sitekey for the web widget.
  (c) Off-platform key custody + reviewer-protection process must exist (§8 gate).
  Keep-on-phone needs none of this — it already works.
- **`directory_intake` (provider intake + report-a-problem).** Needs the staffed
  moderation org to process the `moderation-bulk` queue, plus the Turnstile secret.
- **`incidents_publish` (public browse).** Needs `Verified`/`Community-Corroborated`
  rows (the M2 trust engine writes them) and the counsel gate on the public record.
- **Crisis-card draft banner drops.** The signed-pack pipeline is built
  (`tools/pack` builds a deterministic `.harborage-pack`; `packages/crypto`
  verifies a minisign signature over it against a pinned key). To flip it live
  after the offline key ceremony: (a) add the ceremony public key to
  `PINNED_PACK_PUBKEYS` in `apps/web/src/lib/content-pack.ts`; (b) sign the
  built `apps/web/static/packs/crisis-cards-v1.harborage-pack` offline and set
  the detached signature as `CRISIS_PACK_SIGNATURE` in
  `apps/web/src/lib/crisis-cards.ts`. Trust then comes from the signature, not a
  content field. Counsel/medic content review is a separate readiness gate.

## What must stay manual, and why

| Manual step | Why it can't be code |
|---|---|
| Mint / rotate API tokens | Cloudflare API can't self-bootstrap tokens |
| Dashboard product activations | Dashboard-only, one-time |
| Org-level Access Independent MFA + AAGUID list | Org-scoped setting (not a per-app tofu field); AAGUID pinning needs real ceremony hardware |
| Offline key ceremony | Private keys must never touch CI/Terraform/Cloudflare |
| Warrant-canary signing | Automating it would let a compelled host keep it alive |
| Read the `tofu plan` before apply | The human gate against a destructive/compelled change |
| Production deploy approval | Deliberate 2-person gate |

Everything else — `tofu apply`, `wrangler deploy`, D1 migrations, secret injection, config templating, DNS/Access/Turnstile/WAF provisioning, cache warming, CI gates, smoke tests — is automated.
