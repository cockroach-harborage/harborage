#!/usr/bin/env bash
# One-time GitHub repo hardening (idempotent). Run after the first push.
# Branch protection on main: required checks, signed commits, linear history,
# no force-push, admins included. Also enables secret scanning + push protection.
set -euo pipefail

REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
echo "==> Hardening ${REPO}"

echo "==> Secret scanning + push protection + vulnerability alerts"
gh api -X PATCH "repos/${REPO}" --input - >/dev/null <<'EOF'
{
  "security_and_analysis": {
    "secret_scanning": { "status": "enabled" },
    "secret_scanning_push_protection": { "status": "enabled" }
  },
  "allow_merge_commit": false,
  "allow_rebase_merge": true,
  "allow_squash_merge": true,
  "delete_branch_on_merge": true
}
EOF
gh api -X PUT "repos/${REPO}/vulnerability-alerts" >/dev/null || true

echo "==> Branch protection on main"
gh api -X PUT "repos/${REPO}/branches/main/protection" --input - >/dev/null <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["ci", "e2e", "zizmor", "gitleaks", "tofu-validate"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true
}
EOF
# Required signatures reject any push GitHub cannot verify. Enable only after
# the signing public key is registered on the pushing account
# (gh auth refresh -s admin:ssh_signing_key && gh ssh-key add --type signing).
if [[ "${ENFORCE_SIGNATURES:-}" == "1" ]]; then
  gh api -X POST "repos/${REPO}/branches/main/protection/required_signatures" >/dev/null || true
  echo "==> required_signatures enabled"
else
  echo "==> required_signatures SKIPPED (set ENFORCE_SIGNATURES=1 after registering the signing key)"
fi

echo "Done."
echo
echo "Required checks now include zizmor, gitleaks and tofu-validate. They already"
echo "ran on every PR; until now they could fail red and the PR still merged."
echo
echo "required_pull_request_reviews stays null while the project has a single"
echo "maintainer. That is honest, not a gap to paper over: with one person the"
echo ">=2-reviewer property does not exist, and a second account or a bot approver"
echo "would produce the appearance of the control without the substance. Raise it"
echo "the day a second maintainer exists (CLAUDE.md sensitive-path rule)."
