#!/usr/bin/env bash
# One-time local setup for SSH commit signing (RUNBOOK Part A). Idempotent.
# Configures git to sign every commit and registers the PUBLIC key with GitHub
# as a *signing* key, so branch-protection required_signatures can be enabled
# (scripts/github-setup.sh with ENFORCE_SIGNATURES=1). The private key never
# leaves this machine and is never committed.
#
# This is NOT the offline release/canary key ceremony (RUNBOOK Part A step 5) —
# that stays air-gapped and manual. This only sets up commit-signature verification.
set -euo pipefail

KEY="${SIGNING_KEY:-$HOME/.ssh/harborage_signing}"
command -v gh >/dev/null || { echo "Missing tool: gh"; exit 1; }

if [[ ! -f "$KEY" ]]; then
  echo "==> Generating ed25519 signing key at $KEY (you will be prompted for a passphrase)"
  ssh-keygen -t ed25519 -C "harborage-signing" -f "$KEY"
else
  echo "==> Reusing existing signing key $KEY"
fi

echo "==> Configuring git to sign commits and tags with SSH"
git config --global gpg.format ssh
git config --global user.signingkey "${KEY}.pub"
git config --global commit.gpgsign true
git config --global tag.gpgsign true

echo "==> Registering the PUBLIC key with GitHub as a signing key (idempotent)"
gh auth refresh -s admin:ssh_signing_key
gh ssh-key add "${KEY}.pub" --type signing --title "harborage signing" \
  || echo "    (add skipped — key is likely already registered as a signing key)"

echo
echo "Done. Make a commit, confirm the 'Verified' badge on GitHub, then enable enforcement:"
echo "  ENFORCE_SIGNATURES=1 ./scripts/github-setup.sh"
