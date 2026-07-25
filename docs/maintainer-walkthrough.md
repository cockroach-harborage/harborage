# Maintainer walkthrough — the things only you can do

Everything in this file is here because it **cannot** be code. Keys that must
never touch CI, dashboard toggles with no API, and one document that a human has
to read and re-affirm on purpose. Anything that could be automated already is —
where a step is one command, the command is written out.

Written for a **solo maintainer**. Steps needing a second or third person are in
the last section and are correctly deferred until people join after the build.

Nothing here blocks development. Per ARCHITECTURE §18.2 the build is never
gated; only switching a feature ON is.

---

## Part 1 — Do these soon (about 40 minutes total)

### 1.1 Register your commit-signing key, then require signatures

**Why:** of the 59 commits on `main`, **36 carry a signature but show
"unverified"** because the key was never registered on GitHub, and 23 (the early
direct-to-main work) are unsigned. `required_signatures` is off while CLAUDE.md
lists signed commits as binding. This is a real security property a solo
maintainer *can* have, unlike the ≥2-reviewer rule.

GitHub verifies at display time, so registering the key turns those 36 green
retroactively. The 23 unsigned ones stay unsigned — that is history, not
something to rewrite.

```bash
# 1. Grant the CLI the scope it needs (opens a browser, one time).
gh auth refresh -h github.com -s admin:ssh_signing_key

# 2. Register the PUBLIC half of the key you already sign with.
gh ssh-key add ~/.ssh/id_ed25519.pub --type signing --title "harborage signing"

# 3. Turn on required signatures + the three checks that were not required.
cd ~/projects/cockroach-app
ENFORCE_SIGNATURES=1 bash scripts/github-setup.sh
```

**Verify:** open any recent commit on GitHub. It should show a green
**Verified** badge. If it still says Unverified, the key you registered is not
the one `git config user.signingkey` points at — check with:

```bash
git config user.signingkey     # should match the .pub you registered
```

Note `required_signatures` rejects any push GitHub cannot verify, so enable it
*after* the key is registered, which is the order above. The script skips it
unless `ENFORCE_SIGNATURES=1` for exactly that reason.

> The same script now also makes `zizmor`, `gitleaks` and `tofu-validate`
> required checks. They already ran on every PR, but until now they could fail
> red and the PR would still merge.

---

### 1.2 Confirm the Access MFA posture on the console

**Why:** the console is the only privileged surface — it holds the kill
switches. The docs claimed security-key-only was impossible to enforce; I
checked the live Cloudflare docs and **no documentation supports that claim**
(the only single-method caveat is PIV-key-specific). So you may be able to run a
stricter posture than we thought.

**Do this carefully. A wrong MFA config locks you out of your own kill switches.**

1. Go to **Zero Trust → Settings → Authentication → Access settings → Multi-factor authentication**.
2. Note what is currently set, so you can put it back.
3. Confirm **Use identity provider MFA (AMR matching)** is **OFF**. Leave it off:
   most IdPs omit AAGUID from the `amr` claim, so with it on Access can skip the
   prompt entirely and quietly defeat the point.
4. **Before changing anything**, open a second browser (or a private window) and
   confirm you can still reach `https://console.cockroachharborage.org`. Keep
   that session open as your way back in.
5. Try setting allowed authenticators to **Security key only**. Save.
6. In the *other* browser, log in again. If you get a working WebAuthn prompt,
   it is enforceable — tell me and I will correct the docs to say so.
   **If you see "no available MFA method", revert immediately** using the
   session you kept open, back to `security_key` + `biometrics`.

Either outcome is useful. Right now the docs guess, and I would rather they
record a tested fact.

---

### 1.3 Run the key ceremony

**Why:** the app verifies signatures over its safety content and its warrant
canary. No keys exist yet, so every check fails closed and the crisis cards
carry a draft banner. This is the single change that turns those from
"unverified" into real.

You are generating the **root of trust** for everything the app checks. Do it on
a machine you control, ideally disconnected from the network.

```bash
brew install minisign age          # or: sudo apt install minisign age
cd ~/projects/cockroach-app
bash scripts/keygen-ceremony.sh    # writes to ~/harborage-keys, outside any repo
```

It generates three keys and prints the three **public** halves:

| Key | Signs | Password |
|---|---|---|
| `harborage-pack` | knowledge packs (crisis cards, KYR) | pick a strong one |
| `harborage-canary` | the warrant canary | a **different** strong one |
| `harborage-security` (age) | receives encrypted disclosures | none |

**Then, in order:**

1. **Back up `~/harborage-keys` to two offline media you physically hold.** Lose
   these and every signature the app trusts has to be re-issued and every
   offline copy re-distributed. There is no recovery path, by design.
2. Store the passwords in a password manager. A lost password is a lost key.
3. **Send me the three public keys.** They are safe to share — that is what
   public means. I will pin them in `content-pack.ts`, `canary.ts` and
   `security.txt`, which is a code change, so it is my job not yours.
4. Never copy the `.key` files into the repo, CI, or Cloudflare. Nothing in the
   build needs them.

The script refuses to write keys inside a git working tree, so you cannot commit
them by accident.

---

### 1.4 Write and sign the warrant canary

**Why this stays manual forever:** a canary you can regenerate automatically is
not a canary. The mechanism only works because a person decides, each period,
whether the statement is still true. If a script filled in the dates, a compelled
host could keep it alive and the signal would be worthless.

1. Open `apps/web/static/.well-known/canary.txt`.
2. Replace the three placeholders, having actually checked each:
   - `Requests received (cumulative):` the real number. Almost certainly `0`.
   - `Issued:` today, as `YYYY-MM-DD`.
   - `Valid until:` **a date you will genuinely re-sign before.**
3. Delete the `TEMPLATE (not yet signed)` line and the paragraph explaining that
   it is a template.
4. Sign it:

```bash
bash scripts/sign-release-artifacts.sh
```

That rebuilds the pack, signs it, and signs the canary once the placeholders are
gone. Commit the resulting `.minisig` files and the completed `canary.txt`.

**Choosing the period matters more than it looks.** A canary that quietly expires
because you forgot to re-sign reads to users *exactly* like one pulled because
you were served. Monthly is common. Pick something you will not miss, and set a
calendar reminder now, in the same sitting.

---

## Part 2 — Only when you are ready to switch a feature on

None of this is needed while flags are OFF. Do it at switch-on, not before —
each item creates a credential or a live surface that did not exist.

### 2.1 Turnstile widget (before any intake flag)

**The widget itself will be code, not a dashboard click.** The Terraform provider
has a `cloudflare_turnstile_widget` resource, so the mode, hostname and
`feedback-enabled` setting belong in `infra/` where they are versioned and
reviewable — a dashboard-created widget is exactly the unrecorded drift
CLAUDE.md §"Infrastructure" forbids. I will add that resource when intake
switch-on approaches.

That leaves you two things a token cannot self-bootstrap:

1. **Add `Account → Turnstile → Edit` to `HB_TERRAFORM_TOKEN`** and update the
   secret in the GitHub `production` environment. Terraform then creates the
   widget on the next deploy.
2. **Read the widget secret once it exists** (dashboard → Turnstile → the
   widget) and set it on the api worker — a secret value is the one part that
   must not pass through Terraform state:

```bash
cd workers/api && pnpm exec wrangler secret put TURNSTILE_SECRET
```

The sitekey is public and comes out of Terraform state, so I wire that into the
client without you copying anything.

### 2.2 R2 presign token (before `document_intake`)

1. Dashboard → **R2 → Manage API tokens → Create** — scope it to the
   `harborage-evidence-vault` and `harborage-public-media` buckets only.
2. Set all three on the media worker:

```bash
cd workers/media
pnpm exec wrangler secret put R2_ACCOUNT_ID
pnpm exec wrangler secret put R2_PRESIGN_ACCESS_KEY_ID
pnpm exec wrangler secret put R2_PRESIGN_SECRET_ACCESS_KEY
```

### 2.3 Re-mint `HB_DEPLOY_TOKEN` before the M2 consumer worker lands

The M2 queue consumer binds Queues, and later slices may bind Workers AI. A
binding whose scope the token lacks fails the deploy with **Cloudflare error
10000** — and because all four Workers deploy in one job, that takes the whole
site's deploy down with it. Precedent: commit `c5ed704`.

Add the scopes **before** the PR merges, not after:

1. Dashboard → My Profile → API Tokens → edit `HB_DEPLOY_TOKEN`.
2. Add **Account → Queues → Edit**. Add **Account → Workers AI → Edit** only when
   a worker actually binds AI.
3. Update the `HB_DEPLOY_TOKEN` secret in the GitHub `production` environment.
4. Re-run the latest deploy to confirm, **then** revoke the old token. That order
   matters — revoking first leaves you unable to deploy the fix.

I will tell you which slice needs this, one PR ahead.

### 2.4 Every production deploy

Actions → the run → **Review deployments** → `production` → Approve. Three jobs
pause separately: `plan`, `apply`, then `deploy`.

The first approval only lets `tofu plan` run, which reads and changes nothing.
Approve it without ceremony. **The second one is the one that matters**: by
then the plan is on screen (open the `infra (tofu plan)` job, or read the run
summary, which carries the same output) and the destroy guard has had its say.

Plan and apply used to be one step, so the approval happened before anything
had run and the plan appeared only afterwards. All three jobs are gated because
every secret here is scoped to the `production` environment; an ungated job
reads them as empty and tofu fails with "No valid credential sources found".

A destroy on Email records, the Access application, or signing-key config is a
**bug**. You no longer have to catch it by eye: the **Destroy guard** step fails
the plan job on *any* destroy or replace, including the SPF and DMARC records
that `prevent_destroy` does not cover. If it fails, nothing has been applied.
A genuinely intended removal needs the repository variable `HB_ALLOW_DESTROY`
set to the exact resource addresses, and a line in RUNBOOK.md saying why.

---

### 2.5 Evidence archive (before `archive_publish`)

Everything below is built, tested and shipped **OFF**. None of it blocks
building; each blocks a flag.

| Before flipping | You need | Why it cannot be decided in code |
|---|---|---|
| `archive_publish` | **Counsel sets the probation window** (30–90 days) | §16 leaves the number to counsel. The code defaults to the longest, 90 days, which is the safe direction: certainty about a piece of media grows with time and with new known-bad lists. |
| `archive_publish` | **Counsel + a qualified expert approve the §63 certificate form** | The platform *assembles* the artifact and there is deliberately no code path that signs it. A §63(4) certificate is a statement by a person in charge and a qualified expert; a server that could mint one would be forging their attestation. |
| `archive_publish` | **A rolling known-bad re-scan source** | The probation sweep advances the clock and reports *no* re-scan result, because saying "no hit" without actually scanning would be a claim we cannot support. Until a source exists, an item clears on time-plus-no-objection only. |
| `source_import` | **Counsel on source terms** | Built as fingerprint-and-reference with **no fetch path at all** — `gate-archive-custody` fails the build if one appears. Flipping it stores a publisher's content id and a client fingerprint and nothing else. Re-hosting is a separate, later decision. |
| `evidence_vault` (already listed in 2.2) | **An off-platform custodian in another jurisdiction** | `PINNED_CUSTODIAN_KEYS` ships empty, so every content-key wrap refuses regardless of the flag. |

**One thing to know rather than do:** the archive master ships as **WebP, not
AVIF**, which is a deliberate departure from ARCHITECTURE §16 Lever 2. The live
Images limits table lists "Image dimension, AVIF | 1,200 pixels" against 12,000
for everything else and does not say whether that bounds input or output, and
§7.5's 1,280 px legibility floor is what keeps a badge number readable. If you
ever want AVIF, measure a 2048 px AVIF output against the real account first;
it is one constant (`MASTER_FORMAT` in `workers/media/src/app.ts`) away.

### 2.6 Brokered aid — medical and detention (before `medical_broker`)

**These flags are flippable and flipping them changes nothing.** Medical and
detention brokering are onion-only and refuse over clearnet, and there is no
onion origin, so every one of those routes returns 403 for everyone on every
network. That is the correct resting state, not a bug.

To make them actually work you need, in this order:

1. **An operated Tor v3 `.onion` origin** — a VPS off Cloudflare that terminates
   the circuit and forwards to the Worker ingest endpoint. This is a funded,
   staffed milestone: it is a new compellable party, new ops burden, and its own
   single point of failure. Do not treat it as a weekend task.
2. **Set the ingress secret** once that VPS exists, from `workers/api`:
   ```bash
   pnpm exec wrangler secret put ONION_INGRESS_MAC_KEY
   ```
   Use the same value on the VPS. It verifies a MAC and opens no ciphertext, so
   it is not an unseal key and is deliberately not named like one.
3. **The Capacitor APK bundling Orbot/Arti**, because a stock browser PWA cannot
   reach a `.onion` at all.

Until all three exist, the honest user-facing wording is that this part **is not
open** and needs a different network path and the phone app — never "coming
soon". That wording is a promise to users and wants your sign-off in EN, with a
human HI review.

---

## Part 3 — Deferred until people join after the build

Correctly parked. Each needs a person who is not you, and doing them alone
produces the *appearance* of a control without the substance, which is worse
than the honest gap.

| Deferred | Why it cannot be done solo |
|---|---|
| **Official-notice role keys** | A `safety_directive` needs **3 distinct signers**. Three keys on one laptop is quorum theatre: it presents to users as a quorum while being one person who can be coerced once. Keep `notices_publish` OFF until real co-signers exist. |
| **Counsel sign-off** | The content line, the accountability naming bar, the detainee scheme and the public-record gate each carry real legal exposure and are explicitly counsel-gated. |
| **Medic + lawyer content review** | Crisis cards keep their draft framing until named reviewers exist. Signing proves the file is authentic, not that the advice is right — two different claims, and the app must not blur them. |
| **Staffed moderation org** | Gates the irreversible m-of-n unlocks (naming, unredaction, precise-location reveal, permanent delete). Those ship OFF behind an unsatisfiable quorum by design. |
| **≥2 reviewers on sensitive paths** | Cannot exist with one maintainer. Do **not** add a second account or a bot approver to satisfy it. |
| **Two-person production deploy** | Today the required reviewer is the account that pushes, so it is a confirmation dialog. Add a second reviewer to the `production` environment when someone joins. |
| **Off-platform evidence custodians** | The vault's "we cannot produce plaintext" needs a custodian in another jurisdiction. Gates the evidence tier at M3. `PINNED_CUSTODIAN_KEYS` ships empty so every wrap refuses. |
| **Marshal role keys (M5)** | SAFE_EXIT and DISPERSAL publish only with ≥2 distinct role-bound marshal signatures. `key_directory` has zero rows and migrations carry zero INSERTs, so no quorum can form and no such signal can publish. Needs a key ceremony and a revocation-propagation plan. |
| **≥3 accountability reviewer role keys (M5)** | Publication is quorum-required over an identical canonical record hash. Removal stays single-reviewer, so the worst an infiltrated reviewer can do alone is suppress — an accepted fail-safe direction. |
| **A named human broker for incommunicado alerts (M5)** | Two independent authenticated triggers plus a human confirmation, by design. One person cannot be both triggers and the confirmer. |

---

## Quick reference

| Command | Does |
|---|---|
| `bash scripts/keygen-ceremony.sh` | Generates pack + canary + age keys, prints public halves |
| `bash scripts/sign-release-artifacts.sh` | Rebuilds and signs the pack and canary |
| `ENFORCE_SIGNATURES=1 bash scripts/github-setup.sh` | Branch protection, required checks, required signatures |
| `pnpm exec wrangler secret put NAME` | Sets a worker secret (run in that worker's directory) |

**Never** put a private key, a token, or a secret in the repo. `.gitignore`
covers `*.key`, `*.pem`, `.env*` and `*.tfvars`, gitleaks runs on every PR, and
push protection is on — but those are backstops, not permission to try.
