#!/usr/bin/env bash
# One-time, idempotent bootstrap (RUNBOOK Part A step 6). Re-run safe.
# Reads secrets from .env.bootstrap (gitignored) or the environment. It STOPS at
# `tofu plan` — a human reads the plan (RUNBOOK step 7); CI does the apply.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=".env.bootstrap"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

: "${ZONE_NAME:=cockroachharborage.org}"
need() { [[ -n "${!1:-}" ]] || { echo "Missing required env: $1 (set it in .env.bootstrap)"; exit 1; }; }
need HB_TERRAFORM_TOKEN
need HB_DEPLOY_TOKEN
need R2_STATE_ACCESS_KEY_ID
need R2_STATE_SECRET_ACCESS_KEY
need ADMIN_EMAILS # comma-separated console admin emails
for tool in gh tofu jq curl openssl node pnpm; do
  command -v "$tool" >/dev/null || { echo "Missing tool: $tool"; exit 1; }
done

cf() { # cf <token> <path> [curl args...]
  local token="$1" path="$2"; shift 2
  curl -sS "https://api.cloudflare.com/client/v4${path}" -H "Authorization: Bearer ${token}" "$@"
}

echo "==> Verifying Cloudflare tokens"
for t in HB_TERRAFORM_TOKEN HB_DEPLOY_TOKEN; do
  status=$(cf "${!t}" /user/tokens/verify | jq -r '.result.status')
  [[ "$status" == "active" ]] || { echo "$t is not active (status: $status)"; exit 1; }
  echo "    $t: active"
done

echo "==> Resolving account and zone"
ACCOUNT_ID=$(cf "$HB_TERRAFORM_TOKEN" "/accounts" | jq -r '.result[0].id')
[[ -n "$ACCOUNT_ID" && "$ACCOUNT_ID" != "null" ]] || { echo "Could not resolve account id"; exit 1; }
ZONE_ID=$(cf "$HB_TERRAFORM_TOKEN" "/zones?name=${ZONE_NAME}" | jq -r '.result[0].id')
[[ -n "$ZONE_ID" && "$ZONE_ID" != "null" ]] || {
  echo "Zone ${ZONE_NAME} not found in the account. Add it first (RUNBOOK Part A step 0)."; exit 1;
}
echo "    account: $ACCOUNT_ID  zone: $ZONE_ID"

echo "==> State bucket (the one IaC-cannot-bootstrap-itself exception)"
export CLOUDFLARE_API_TOKEN="$HB_TERRAFORM_TOKEN"
export CLOUDFLARE_ACCOUNT_ID="$ACCOUNT_ID"
if ! pnpm exec wrangler r2 bucket list 2>/dev/null | grep -q "harborage-tfstate"; then
  pnpm exec wrangler r2 bucket create harborage-tfstate
else
  echo "    harborage-tfstate exists"
fi

echo "==> Vectorize index (dimension immutable at creation — 768, cosine)"
if ! pnpm exec wrangler vectorize list 2>/dev/null | grep -q "harborage-embeddings"; then
  pnpm exec wrangler vectorize create harborage-embeddings --dimensions=768 --metric=cosine
else
  echo "    harborage-embeddings exists"
fi

echo "==> DNS snapshot (restore source if a later change breaks records)"
mkdir -p infra/.snapshots
cf "$HB_TERRAFORM_TOKEN" "/zones/${ZONE_ID}/dns_records/export" \
  > "infra/.snapshots/dns-$(date +%Y%m%d-%H%M%S).txt"

echo "==> GitHub production environment + secrets"
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
gh api -X PUT "repos/${REPO}/environments/production" \
  -f "reviewers[][type]=User" \
  -F "reviewers[][id]=$(gh api user -q .id)" >/dev/null
set_secret() { gh secret set "$1" --env production --body "$2" >/dev/null && echo "    secret $1 set"; }
set_secret HB_TERRAFORM_TOKEN "$HB_TERRAFORM_TOKEN"
set_secret HB_DEPLOY_TOKEN "$HB_DEPLOY_TOKEN"
set_secret R2_STATE_ACCESS_KEY_ID "$R2_STATE_ACCESS_KEY_ID"
set_secret R2_STATE_SECRET_ACCESS_KEY "$R2_STATE_SECRET_ACCESS_KEY"
if [[ -n "${GITHUB_IDP_CLIENT_SECRET:-}" ]]; then
  set_secret TF_VAR_github_idp_client_secret "$GITHUB_IDP_CLIENT_SECRET"
fi
# Server-side salts/peppers: generated exactly once, never printed, never reused.
if ! gh secret list --env production | grep -q "HB_HMAC_PEPPER"; then
  set_secret HB_HMAC_PEPPER "$(openssl rand -hex 32)"
fi
gh variable set ADMIN_HANDLES --body "$ADMIN_EMAILS" >/dev/null
gh variable set CF_ACCOUNT_ID --body "$ACCOUNT_ID" >/dev/null
gh variable set ZONE_NAME --body "$ZONE_NAME" >/dev/null
gh variable set GITHUB_IDP_CLIENT_ID --body "${GITHUB_IDP_CLIENT_ID:-}" >/dev/null
echo "    variables ADMIN_HANDLES, CF_ACCOUNT_ID, ZONE_NAME, GITHUB_IDP_CLIENT_ID set"

echo "==> Rendering backend.hcl + terraform.tfvars (gitignored)"
cat > infra/backend.hcl <<EOF
bucket       = "harborage-tfstate"
key          = "harborage.tfstate"
region       = "auto"
endpoint     = "https://${ACCOUNT_ID}.r2.cloudflarestorage.com"
use_lockfile = true

skip_credentials_validation = true
skip_region_validation      = true
skip_requesting_account_id  = true
skip_metadata_api_check     = true
skip_s3_checksum            = true
EOF
admin_emails_hcl=$(node -e 'console.log(JSON.stringify(process.argv[1].split(",").map(s=>s.trim()).filter(Boolean)))' "$ADMIN_EMAILS")
cat > infra/terraform.tfvars <<EOF
account_id   = "${ACCOUNT_ID}"
zone_name    = "${ZONE_NAME}"
admin_emails = ${admin_emails_hcl}
github_idp_client_id = "${GITHUB_IDP_CLIENT_ID:-}"
EOF

echo "==> tofu init / validate / plan (STOPS HERE — a human reads the plan)"
export AWS_ACCESS_KEY_ID="$R2_STATE_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_STATE_SECRET_ACCESS_KEY"
export TF_VAR_github_idp_client_secret="${GITHUB_IDP_CLIENT_SECRET:-}"
cd infra
tofu init -backend-config=backend.hcl -input=false
tofu validate
tofu plan -input=false
echo
echo "Bootstrap complete. Read the plan above (RUNBOOK Part A step 7)."
echo "Any change or destroy on DNS/Access/signing config is a bug: stop and investigate."
echo "When the plan is clean, push to main — CI applies and deploys."
