#!/usr/bin/env bash
# Offline signing-key ceremony (RUNBOOK Part A step 5).
#
# Generates the project signing keys and prints the PUBLIC halves to pin. It
# deliberately does NOT touch the repo, CI, or Cloudflare: private keys must
# never enter any of them, and this script refuses to write one inside a git
# working tree.
#
# What it makes:
#   pack    minisign  signs .harborage-pack knowledge packs (crisis cards, KYR)
#   canary  minisign  signs the warrant canary
#   age     age       receives encrypted security disclosures
#
# Deliberately NOT made here: the official-notice ROLE keys. Those need m-of-n
# distinct human signers (3 for a safety_directive) and generating them all on
# one laptop would be quorum theatre — it presents as a quorum while being one
# person. They wait for real co-signers.
#
# Run this on a machine that is offline if you can. The keys it writes are the
# root of trust for everything the app verifies.
set -euo pipefail

OUT="${1:-$HOME/harborage-keys}"

# Refuse to write private keys anywhere they could be committed. Check the
# nearest EXISTING ancestor, so this still fires for a path that does not exist
# yet but would be created inside a repo.
probe="$OUT"
while [[ ! -d "$probe" && "$probe" != "/" && "$probe" != "." ]]; do
	probe=$(dirname "$probe")
done
if git -C "$probe" rev-parse --git-dir >/dev/null 2>&1; then
	echo "REFUSING: $OUT is inside a git working tree ($probe)." >&2
	echo "Private keys must never be committable. Pick a path outside any repo." >&2
	exit 1
fi

missing=0
for tool in minisign age; do
	command -v "$tool" >/dev/null 2>&1 || { echo "missing: $tool"; missing=1; }
done
if [[ $missing -eq 1 ]]; then
	cat >&2 <<'EOF'

Install the missing tools first:
  macOS    brew install minisign age
  Debian   sudo apt install minisign age

Both are small, widely packaged, and verify offline.
EOF
	exit 1
fi

mkdir -p "$OUT"
chmod 700 "$OUT"
cd "$OUT"

echo "==> Writing keys to $OUT"
echo "    You will be asked for a password per minisign key. Use a strong,"
echo "    DIFFERENT password for each, and store them in a password manager."
echo "    A lost password means a lost key, and there is no recovery."
echo

for name in pack canary; do
	if [[ -f "harborage-$name.key" ]]; then
		echo "==> $name key already exists, leaving it alone"
		continue
	fi
	echo "==> Generating the $name signing key"
	minisign -G -s "harborage-$name.key" -p "harborage-$name.pub"
	echo
done

if [[ -f harborage-security.age.key ]]; then
	echo "==> age key already exists, leaving it alone"
else
	echo "==> Generating the security-disclosure age key"
	age-keygen -o harborage-security.age.key 2>/dev/null
	# age-keygen prints the public key to stderr; recover it from the file.
	age-keygen -y harborage-security.age.key > harborage-security.age.pub
fi

chmod 600 ./*.key 2>/dev/null || true

cat <<EOF

========================================================================
PUBLIC KEYS — these are safe to share, and are what gets pinned in code.
========================================================================

pack signing (pin in apps/web/src/lib/content-pack.ts PINNED_PACK_PUBKEYS):
$(tail -n1 harborage-pack.pub)

canary signing (pin in apps/web/src/lib/canary.ts PINNED_CANARY_PUBKEYS):
$(tail -n1 harborage-canary.pub)

security disclosures (publish in /.well-known/security.txt):
$(cat harborage-security.age.pub)

========================================================================
NOW DO THESE, in order:
  1. Back up $OUT to two offline media you physically control.
     Losing these keys means every signature the app trusts must be
     re-issued and every offline copy re-distributed.
  2. Write the three public keys above somewhere you can re-read them.
  3. Hand the three public keys over to be pinned in code.
  4. Keep the private .key files OFF this repo, OFF CI, OFF Cloudflare.
     Nothing in the build ever needs them; only your signing commands do.
========================================================================
EOF
