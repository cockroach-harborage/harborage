# Harborage — Bootstrap Walkthrough (companion to RUNBOOK Part A)

The **manual surface only**, click-by-click, with actual values and the exact on-screen strings to look for. Anything runnable lives in `scripts/` and is **not** repeated here as a human step — this file covers what a person genuinely must do in a browser or at a prompt.

- **UIs verified against live Cloudflare / GitHub docs on 2026-07-22.** Cloudflare renames dashboard controls often — where a label may have drifted it is flagged; when a string differs, trust the **navigation path**, which is stable.
- **Governing rule (CLAUDE.md):** anything that can be code is code. So `wrangler r2 bucket create`, `wrangler vectorize create`, backend/tfvars rendering, GitHub environment + secrets/variables, DNS snapshot, branch protection, and the token-verify check are **already scripted** — see [what the scripts do](#automated). You do not type those.

## What you actually do by hand

| # | Manual action | Where | Status |
|---|---|---|---|
| [M1](#m1) | Confirm the zone is Active | CF dash | ⬜ to confirm |
| [M2](#m2) | Product activations | CF dash | ✅ done 2026-07-24 |
| [M3](#m3) | Mint the R2 state S3 keys | CF dash → R2 | ⬜ |
| [M4](#m4) | Mint the two CF API tokens | CF dash → My Profile | ⬜ |
| [M5](#m5) | Create the GitHub OAuth App | github.com | ⬜ |
| [M6](#m6) | `gh auth login` | terminal | ⬜ |
| [M7](#m7) | Offline key ceremony | air-gapped machine | ⬜ |
| [M8](#m8) | Fill `.env.bootstrap`, run `bootstrap.sh` | terminal | ⬜ |
| [M9](#m9) | Read the `tofu plan` | terminal | ⬜ |
| [M10](#m10) | Sign commits, push, approve `production` | GitHub | ⬜ |

**Known values (baked into code):** zone `cockroachharborage.org`; workers.dev subdomain + Zero Trust team + GitHub org all `cockroach-harborage` (hyphenated — note the zone is not); Access team domain `cockroach-harborage.cloudflareaccess.com`.

---

<a name="m1"></a>
## M1 — Add `cockroachharborage.org` as a Cloudflare zone

Terraform's `data "cloudflare_zone"` **reads** the zone by name; it doesn't create it. The zone must exist and be **Active** before any `tofu plan` resolves. **Free plan is correct** — Access, Workers, R2, KV, D1, Queues, AI Gateway are all account-level and work on a Free zone. Do not upgrade the zone.

### Case A — bought via Cloudflare Registrar (no nameserver step)

The zone already exists and is **`Active`** (Registrar domains use Cloudflare nameservers). Confirm: left sidebar **Domains** → `cockroachharborage.org` shows **`Active`**. If so, **skip Case B**.

### Case B — external registrar

1. `https://dash.cloudflare.com` → **Domains** → **`Onboard a domain`** (renamed from "Add site"; older UI: **`Add a domain`** / **`+ Add`**).
2. Enter apex `cockroachharborage.org` (no `www`, no scheme).
3. DNS import: **`Quick scan for DNS records`** → **`Continue`**.
4. Plan card: **`Free`** (**`$0/month`**) → **`Continue`**. No card required.
5. **Delete any scanned apex `TXT` SPF and any `_dmarc` `TXT`** from the import list — Terraform owns those (below). Do not add apex `A`/`AAAA`/`CNAME` (the Worker Custom Domain owns it).
6. Copy the **two assigned nameservers** (`xxxx.ns.cloudflare.com` / `yyyy.ns.cloudflare.com`, unique to your zone). Status → **`Pending Nameserver Update`**.
7. At the registrar: set nameservers to **Custom** and **replace all** existing NS with the exact two.
8. Back in Cloudflare, **`Check nameservers now`** if impatient. Status flips to **`Active`** (email subject ≈ "cockroachharborage.org is now active on Cloudflare"). Propagation: minutes to a few hours; up to 24h.

### DNS reconciliation (why step 5 matters)

Terraform (`cloudflare_dns_record` ×2) owns exactly: apex `TXT` = `v=spf1 -all`, and `_dmarc.cockroachharborage.org` `TXT` = `p=reject; sp=reject; adkim=s; aspf=s`. A leftover scanned SPF/DMARC `TXT` creates a duplicate (invalid — one SPF record allowed) and can make `tofu apply` fight the record. The apex `A`/`AAAA`/`CNAME` belongs to the Worker `custom_domain: true` route (Wrangler), a **different record type** from the SPF `TXT`, so the two coexist — never create it manually or in Terraform. `bootstrap.sh` snapshots live DNS (`GET /zones/{id}/dns_records/export`) before anything applies. A clean plan proposes **only** the two TXT creates; a plan destroying an apex A/AAAA/CNAME or Email record is a bug.

---

<a name="m2"></a>
## M2 — Product activations ✅ done (2026-07-24)

Recorded, with the actual values (all baked into code now):

| Item | Result |
|---|---|
| Workers Paid | Active. The Upgrade button charged **$5/mo directly** — no plan-selection screen. Vectorize now unblocked. |
| workers.dev subdomain | `harborage` was taken → claimed **`cockroach-harborage.workers.dev`**. (Both Workers set `workers_dev: false`, so nothing is served there.) |
| R2 | Subscription active — state bucket + backend unblocked. |
| Zero Trust / Access | Team name **`cockroach-harborage`** → team domain **`cockroach-harborage.cloudflareaccess.com`**. Now defaulted in `bootstrap.sh` and `.env.bootstrap.example`, so you don't re-enter it. |
| Vectorize / AI Gateway / Queues | No click needed (Queues: click a one-time `Enable Queues` interstitial only if one appears). |

**Still do NOT enable Email Routing** — onboarding it pushes MX/SPF records that fight the null SPF (`v=spf1 -all`) + reject DMARC anti-spoofing. Leave it (and its token permission) off until operator email is provisioned (`email.tf`).

---

<a name="m3"></a>
## M3 — Mint the R2 state S3 keys

The bucket-scoped S3 keys are the sole IaC-can't-bootstrap-itself exception, and are **distinct** from both CF API tokens. `bootstrap.sh` creates the bucket idempotently; the manual part is minting the keys, which needs the bucket to exist so you can scope to it.

1. **R2 Object Storage → `Create bucket`** → name `harborage-tfstate` → **`Location: Automatic`** (do **not** click **`Specify jurisdiction`** — it's immutable and moves the S3 endpoint) → **`Default storage class: Standard`** → **`Create bucket`**.
2. **R2 → Overview →** right panel **`API` → `Manage API tokens`** → **`Create API token`** → **`Create Account API token`** (survives a person leaving) — not the User variant.
3. **Token name:** `harborage-tfstate-rw`. **Permissions:** **`Object Read & Write`** (not Admin; options are `Admin Read & Write` / `Admin Read only` / `Object Read & Write` / `Object Read only`). **Scope:** **`Apply to specific buckets only`** → **`harborage-tfstate`**. **TTL:** 1 year.
4. **`Create Account API token`** → copy immediately (secret shown once):
   - **`Access Key ID`** → `.env.bootstrap` `R2_STATE_ACCESS_KEY_ID`
   - **`Secret Access Key`** → `.env.bootstrap` `R2_STATE_SECRET_ACCESS_KEY`
   - endpoint `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` (bootstrap derives it from the account id)

> Good to know: the state backend uses `use_lockfile = true` (R2 conditional `PutObject` on `harborage.tfstate.tflock` — no DynamoDB) and `skip_s3_checksum = true` (R2 rejects the AWS SDK's default checksums). Both are already in the rendered `backend.hcl`. If a future SDK bump revives `XAmzContentSHA256Mismatch`, also export `AWS_REQUEST_CHECKSUM_CALCULATION=when_required` + `AWS_RESPONSE_CHECKSUM_VALIDATION=when_required` in the CI `infra` job.

---

<a name="m4"></a>
<a name="step-1"></a>
## M4 — Mint the two Cloudflare API tokens

**Creator location:** profile icon (top-right) → **`My Profile`** → **`API Tokens`** (`https://dash.cloudflare.com/profile/api-tokens`) → **`Create Token`** → scroll to **`Create Custom Token`** → **`Get started`**. (An **account-owned** token that survives a member leaving lives under **`Manage Account` → `Account API Tokens`** — same rows.) Each row = **scope** (`Account`/`Zone`/`User`) → **permission group** → **level**. The dropdown says **`Edit`** where docs say "Write".

### `HB_TERRAFORM_TOKEN` (used only in the CI `infra` job)

| Scope | Permission group (verbatim) | Level | Authorizes |
|---|---|---|---|
| Zone | **Zone** | Read | `data.cloudflare_zone` |
| Zone | **DNS** | Edit | `cloudflare_dns_record` ×2 (SPF, DMARC) |
| Zone | **Zone Settings** | Edit | `cloudflare_zone_setting` ×3 |
| Account | **Access: Organizations, Identity Providers, and Groups** | Edit | GitHub IdP |
| Account | **Access: Apps and Policies** | Edit | console app + policy |
| Account | **Workers R2 Storage** | Edit | 3 buckets + CORS + lifecycle |
| Account | **Workers KV Storage** | Edit | 5 namespaces |
| Account | **D1** | Edit | `harborage` db |
| Account | **Queues** | Edit | 4 queues |
| Account | **AI Gateway** | Edit | `harborage-gw` (`Edit`, not `Run`) |
| Account | **Vectorize** | Edit | `harborage-embeddings` index — created by `bootstrap.sh` (wrangler), not tofu, so it's easy to miss |
| Account | **Account Settings** | Read | provider account introspection (optional, harmless) |

The two Access rows are **different groups** (IdP vs app+policy). Both correct at **Account** scope because `access.tf` uses `account_id`. `Zone` (Read) and `Zone Settings` (Edit) are also distinct groups. **Defer** the headroom — add `Turnstile` (Account), `Zone WAF` (Zone), `Email Routing Rules` (Zone) + `Email Routing Addresses` (Account) in the same PR that adds their resource, then re-mint (the token rotates quarterly anyway; pre-minting widens blast radius against the deprivileged-token posture).

### `HB_DEPLOY_TOKEN` (used only in the CI `deploy` job; rotate quarterly)

| Scope | Permission group (verbatim) | Level | Authorizes |
|---|---|---|---|
| Account | **Workers Scripts** | Edit | `wrangler deploy`; DO `new_sqlite_classes` migration; DO/KV/D1 bindings; Workers Logs; `wrangler secret put ACCESS_AUD` (classic secret = a Workers-Scripts write) |
| Account | **Workers KV Storage** | Edit | KV bindings |
| Account | **D1** | Edit | `d1 migrations apply harborage --remote` |
| Zone | **Workers Routes** | Edit | `custom_domain: true` on apex + `console.` |
| Account | **Account Settings** | Read | account resolution |

**Do NOT add Zone `DNS`: Edit on first mint.** Worker Custom Domains create the proxied DNS record **and** issue the cert **server-side** (Cloudflare's own auto Workers token has no DNS permission). Add `DNS: Edit` only if a real `wrangler deploy` 403s on the DNS-record step (confirm on the first live deploy — see [Appendix](#appendix)). Leave `SSL and Certificates` off. Add `Queues`/`Workers R2 Storage`/`Workers AI` (Read/Edit) only when a Worker actually binds them (today's `apps/web` + `apps/console` configs bind none).

### Scoping, IP filter, TTL

- **`Account Resources`:** `Include` → `Specific account` → the Harborage account (not `All accounts`). **`Zone Resources`:** `Include` → `Specific zone` → `cockroachharborage.org` (not `All zones`; the block appears only after a Zone-scope row is added).
- **`Client IP Address Filtering`:** leave **blank** for GitHub-hosted runners (their IPs rotate — an allowlist breaks CI; `harden-runner` egress-block is the compensating control). Only add an `Is in` CIDR for self-hosted static-egress runners.
- **`TTL`:** set an **`Expiration Date`** ~90 days out to force the quarterly rotation. Rotate the GitHub secret before it lapses.
- **`Continue to summary` → `Create Token`** → copy the value once into `.env.bootstrap` (`HB_TERRAFORM_TOKEN` / `HB_DEPLOY_TOKEN`). `bootstrap.sh` verifies each against `/user/tokens/verify` (expects `status: active`) — you don't run that check by hand.

---

<a name="m5"></a>
## M5 — GitHub OAuth App backing the Access GitHub IdP

`access.tf` creates the IdP from `github_idp_client_id` + `github_idp_client_secret`, so you create the OAuth App that supplies them and route the values **into CI** — do **not** type them into the Cloudflare dashboard.

1. Team domain is `cockroach-harborage.cloudflareaccess.com` (from M2d).
2. `github.com` → avatar → **Settings** → **Developer settings** → **OAuth Apps** → **`New OAuth App`** (the repo is `cockroach-harborage/harborage`, so prefer the **org**'s Developer settings for an org-owned app). Fill exactly:
   - **Application name:** `Harborage console (Cloudflare Access)`
   - **Homepage URL:** `https://cockroach-harborage.cloudflareaccess.com`
   - **Authorization callback URL** (must be exact): `https://cockroach-harborage.cloudflareaccess.com/cdn-cgi/access/callback`
   - Leave Device Flow unchecked → **`Register application`**.
3. Copy the **Client ID**; click **`Generate a new client secret`** and copy the secret (shown once).
4. Put them in `.env.bootstrap`: `GITHUB_IDP_CLIENT_ID=...` (becomes GH **variable** `IDP_GITHUB_CLIENT_ID` — GitHub reserves the `GITHUB_` prefix for variable names) and `GITHUB_IDP_CLIENT_SECRET=...` (becomes GH **secret** `TF_VAR_github_idp_client_secret`, auto-bound to `var.github_idp_client_secret`). `bootstrap.sh` sets both — you don't run `gh` for this.

---

<a name="m6"></a>
## M6 — `gh auth login`

`gh auth login` → **GitHub.com** → **HTTPS** → **Login with a web browser**. The default flow grants `repo`, `read:org`, `workflow`, `gist` — enough for everything `bootstrap.sh` + `github-setup.sh` do (create the `production` environment, set env secrets + repo variables, PATCH `security_and_analysis`, PUT branch protection). Add `admin:org` only if an org-scoped call 403s. Verify with `gh auth status`. (The `admin:ssh_signing_key` scope for commit signing is added later by `scripts/setup-commit-signing.sh` — M10.)

---

<a name="m7"></a>
## M7 — Offline key ceremony

Air-gapped m-of-n ceremony (RUNBOOK Part A step 5) generating the release/knowledge-pack signing keys, official-notice role keys, and warrant-canary key. **Commit only the public keys**; private keys go to the offline vault and never touch CI/Terraform/Cloudflare. This is **not** the commit-signing key (that's M10 / `setup-commit-signing.sh`).

---

<a name="m8"></a>
## M8 — Fill `.env.bootstrap`, then run the script

Copy `.env.bootstrap.example` → `.env.bootstrap` (gitignored) and fill from the steps above:
```
HB_TERRAFORM_TOKEN=...                 # M4
HB_DEPLOY_TOKEN=...                    # M4
R2_STATE_ACCESS_KEY_ID=...             # M3
R2_STATE_SECRET_ACCESS_KEY=...         # M3
ADMIN_EMAILS=you@example.org           # comma-separated console admins
GITHUB_IDP_CLIENT_ID=...               # M5
GITHUB_IDP_CLIENT_SECRET=...           # M5
# ZONE_NAME and ACCESS_TEAM_DOMAIN are already defaulted in bootstrap.sh —
# set them only to override.
```
You only fill the six credential lines (M3/M4/M5) plus `ADMIN_EMAILS`. `ZONE_NAME` (`cockroachharborage.org`) and `ACCESS_TEAM_DOMAIN` (`cockroach-harborage.cloudflareaccess.com`) are baked in.
Then:
```
bash scripts/bootstrap.sh
```
It stops at `tofu plan` (M9). See [what it does](#automated).

---

<a name="m9"></a>
## M9 — Read the plan (the human gate)

Expect **creates only**: 2 DNS TXT, 3 zone settings, 1 Access IdP + 1 app + 1 policy, 3 R2 buckets + 2 CORS + 1 lifecycle, 5 KV, 1 AI Gateway, 4 Queues, 1 D1. **Any change or destroy on DNS / Access / Email / signing config is a bug — stop, never apply.** `prevent_destroy` guards the D1 db, the three R2 buckets, and the Access application.

---

<a name="m10"></a>
## M10 — Sign commits, push, approve

1. `bash scripts/setup-commit-signing.sh` — sets up SSH commit signing and registers the signing key with GitHub (adds the `admin:ssh_signing_key` scope, `--type signing`). Make a commit, confirm the **`Verified`** badge.
2. `bash scripts/github-setup.sh` — branch protection (required checks `ci`+`e2e`, linear history, no force-push, admins included; secret scanning + push protection). Re-run with `ENFORCE_SIGNATURES=1` once the signing key is live.
3. Push `main` → the `deploy` workflow runs `infra` (apply) then `deploy` (wrangler). When CI pauses: repo → **`Actions`** → the run → **`Review deployments`** → check **`production`** → **`Approve and deploy`**. Only a listed reviewer can approve.
4. **Verify:** `curl -s -o /dev/null -w '%{http_code}\n' https://cockroachharborage.org/` → `200`; `…/console.cockroachharborage.org/` → **not** `200` (Access redirect). The deploy job asserts both; `/console` open without Access is a fail-closed violation. Also confirm a signed knowledge pack verifies on-device and `/.well-known/canary.txt` is live and signed.

---

<a name="automated"></a>
## What the scripts do (do NOT run these by hand)

`scripts/bootstrap.sh` (idempotent): verifies both CF tokens are `active`; resolves account + zone IDs; `wrangler r2 bucket create harborage-tfstate` if missing; `wrangler vectorize create harborage-embeddings --dimensions=768 --metric=cosine`; snapshots DNS via the export API; creates the GitHub `production` environment with you as required reviewer; sets secrets (`HB_TERRAFORM_TOKEN`, `HB_DEPLOY_TOKEN`, `R2_STATE_*`, `TF_VAR_github_idp_client_secret`, one-time `HB_HMAC_PEPPER`) + variables (`ADMIN_HANDLES`, `CF_ACCOUNT_ID`, `ZONE_NAME`, `IDP_GITHUB_CLIENT_ID`, `ACCESS_TEAM_DOMAIN`); renders `backend.hcl` + `terraform.tfvars`; runs `tofu init/validate/plan` and stops.

`scripts/github-setup.sh`: repo hardening + branch protection (+ `required_signatures` when `ENFORCE_SIGNATURES=1`).
`scripts/setup-commit-signing.sh`: SSH commit-signing setup + registers the signing key.
CI `deploy.yml`: renders backend/tfvars inline, `tofu apply`, injects resource IDs (incl. `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`) into the wrangler configs, `wrangler deploy`, `d1 migrations apply --remote`, `wrangler secret put`, smoke tests.

---

<a name="appendix"></a>
## Appendix — confirm on a live account

1. **`HB_DEPLOY_TOKEN` + Custom Domains:** strong evidence Zone `DNS`: Edit is unnecessary (the official auto Workers token lacks it). If the first custom-domain deploy 403s on the DNS step, add it and re-run.
2. **Zone-scoped `Email Routing Rules`** verbatim picker label (the account sibling `Email Routing Addresses` is confirmed) — only matters when Email Routing is un-deferred.
3. **`Zone WAF` vs `Account Rulesets`** for the eventual rate-limit ruleset — confirm via `tofu plan` when that resource is added (likely moot: custom-characteristic rate-limiting isn't on the funded plan).
4. Dashboard **micro-strings** (`Purchase R2` / `Purchase`, any `Enable Queues` interstitial) are the most likely to have been renamed since 2026-07-22 — trust the nav path.

**Still manual, separate from this bootstrap:** each `admin_emails` entry must enroll a **FIDO2 hardware key** with Access (the `console-admins-hardware-key` policy requires `auth_method = "swk"`). Without an enrolled key, that admin cannot pass the console policy.
