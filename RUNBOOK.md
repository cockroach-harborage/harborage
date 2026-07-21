# RUNBOOK.md — Harborage

Manual steps only. **Anything that can be code is code** (OpenTofu / Wrangler / CI — see [ARCHITECTURE.md §17](./ARCHITECTURE.md)). A step is here only because a human genuinely must do it. Anything mutated outside the repo is unrecorded drift; if you do a manual write, record it here in the same PR.

The whole manual surface is small: mint tokens, click a few one-time dashboard activations, run one offline key ceremony, run one bootstrap script, read one plan, approve the deploy. Everything recurring is "edit a GitHub var/secret and re-run the workflow."

---

## Part A — One-time bootstrap (ordered)

0. **Add the production domain as a Cloudflare zone.** The domain is `cockroachharborage.org` (registered 2026-07-22). If it was bought via Cloudflare Registrar the zone already exists; otherwise add the site in the dashboard and point the registrar's nameservers at Cloudflare. The zone name is supplied to IaC via `terraform.tfvars` (gitignored) — never hardcoded. *(GitHub remote: `cockroach-harborage/harborage`, created in Session 3 via `gh repo create`; branch protection + `production` environment are applied by script, recorded here because repo creation itself is a one-time act.)*

1. **Mint scoped Cloudflare API tokens in the dashboard** — the API cannot self-bootstrap tokens. Create three, scoped by blast radius:
   - `HB_TERRAFORM_TOKEN` — DNS Edit, Zone Settings, Access (apps/policies/orgs/IdPs), Account Rulesets/WAF, D1, KV, R2, Queues, Turnstile, AI Gateway, Email Routing. Used only in the CI `infra` job.
   - `HB_DEPLOY_TOKEN` — Workers Scripts/Routes Edit, D1, KV, R2, Queues, Workers AI. Used only in the CI `deploy` job. **Rotate quarterly** (Part B).
   - Read-only worker tokens (e.g. analytics) — minimal scope, live inside the Worker so a compromised Worker can never deploy or edit DNS.
2. **One-time product activations in the dashboard** (dashboard-only): enable **Workers Paid** (Durable Objects + Queues + Workers AI require it), **R2**, **Zero Trust / Access**, **Queues**, **Vectorize**, **AI Gateway**, **Email Routing**; register a `workers.dev` subdomain (cron triggers refuse to deploy without one even with `workers_dev:false`).
3. **Create the R2 state bucket** (the one IaC-can't-bootstrap-itself exception): `wrangler r2 bucket create harborage-tfstate`, then mint bucket-scoped R2 access keys for Terraform state.
4. **`gh auth login`** (needs repo admin, to create the `production` environment + secrets).
5. **Offline key ceremony (MUST stay manual — security).** On an air-gapped machine, run the documented m-of-n ceremony to generate: the project release/knowledge-pack signing keys, the official-notice role keys, and the warrant-canary key. Commit/deploy **only the public keys**. Private keys go to the offline vault and never touch CI, Terraform, or Cloudflare.
6. **Run `bash scripts/bootstrap.sh`** — idempotent: verifies the three tokens, resolves account/zone IDs, generates any server-side salts/peppers once (`openssl rand`), creates the state bucket if missing, `wrangler vectorize create`, creates the GitHub `production` environment and sets every secret + the `ADMIN_HANDLES` variable via `gh secret set --env production`, snapshots current DNS, writes `backend.hcl` + `terraform.tfvars`, and finishes with `tofu init/validate/plan`. **It stops at the plan — it never applies.**
7. **Read the `tofu plan` (the human gate).** Any change or destroy on Email/DNS/Access/signing-key config is a bug: stop and investigate, never apply.
8. **Push to `main`** → CI applies infra, then deploys. Approve the protected `production` environment when prompted.
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

## What must stay manual, and why

| Manual step | Why it can't be code |
|---|---|
| Mint / rotate API tokens | Cloudflare API can't self-bootstrap tokens |
| Dashboard product activations | Dashboard-only, one-time |
| Offline key ceremony | Private keys must never touch CI/Terraform/Cloudflare |
| Warrant-canary signing | Automating it would let a compelled host keep it alive |
| Read the `tofu plan` before apply | The human gate against a destructive/compelled change |
| Production deploy approval | Deliberate 2-person gate |

Everything else — `tofu apply`, `wrangler deploy`, D1 migrations, secret injection, config templating, DNS/Access/Turnstile/WAF provisioning, cache warming, CI gates, smoke tests — is automated.
