#!/usr/bin/env bash
# Sign the knowledge pack and the warrant canary with the offline keys.
#
# Usage:  scripts/sign-release-artifacts.sh [KEY_DIR]        (default ~/harborage-keys)
#
# Run this from a checkout, with the private keys on the same machine. It writes
# detached .minisig files next to the artifacts. Those signature files ARE
# committed; the private keys are not, and this script never reads them from,
# or writes them to, the repo.
#
# The canary is signed here but its STATEMENT is not written here, on purpose.
# A canary you can regenerate without a human reading and re-affirming it is not
# a canary: the whole mechanism depends on a person deciding, each period,
# whether the statement is still true. If this script filled in the dates for
# you, a compelled host could keep it alive.
set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel)
KEY_DIR="${1:-$HOME/harborage-keys}"
PACK="$REPO_ROOT/apps/web/static/packs/crisis-cards-v1.harborage-pack"
CANARY="$REPO_ROOT/apps/web/static/.well-known/canary.txt"

command -v minisign >/dev/null 2>&1 || { echo "minisign not installed (brew install minisign)"; exit 1; }
[[ -f "$KEY_DIR/harborage-pack.key" ]] || { echo "no pack key at $KEY_DIR — run scripts/keygen-ceremony.sh first"; exit 1; }
[[ -f "$KEY_DIR/harborage-canary.key" ]] || { echo "no canary key at $KEY_DIR"; exit 1; }

echo "==> Rebuilding the pack so the signature covers exactly what ships"
(cd "$REPO_ROOT" && pnpm pack:build >/dev/null && pnpm pack:verify)

echo
echo "==> Signing the knowledge pack"
minisign -S -s "$KEY_DIR/harborage-pack.key" -m "$PACK" -t "harborage crisis-cards pack"
echo "    wrote $(basename "$PACK").minisig"

echo
if grep -q '\[to be completed by operators\]\|\[date, completed at signing\]' "$CANARY"; then
	cat <<EOF
==> CANARY NOT SIGNED — the statement still has placeholders.

Open this file and complete it yourself, then re-run:
  $CANARY

You must fill in, having actually checked each one:
  Requests received (cumulative):  the real number, usually 0
  Issued:                          today, YYYY-MM-DD
  Valid until:                     a date you will genuinely re-sign before

Pick a period you can keep. A canary that silently expires because nobody
re-signed it reads to users exactly like a canary that was pulled because you
were served. Monthly is common; choose what you will not miss.
EOF
	exit 0
fi

echo "==> Signing the warrant canary"
minisign -S -s "$KEY_DIR/harborage-canary.key" -m "$CANARY" -t "harborage warrant canary"
echo "    wrote $(basename "$CANARY").minisig"

cat <<EOF

Done. Now commit the two .minisig files (and the completed canary.txt):
  git add apps/web/static/packs/*.minisig apps/web/static/.well-known/canary.txt*
  git commit -m "chore(signing): sign knowledge pack and warrant canary"

The app only trusts these once the matching PUBLIC keys are pinned in
content-pack.ts and canary.ts. Until then both verify as unestablished, which
is the correct fail-closed state.
EOF
