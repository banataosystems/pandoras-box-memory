#!/usr/bin/env bash
set -euo pipefail

# Pandora Memory source-control guard.
# Scan executable/runtime and migration source, not evidence documentation.
# This is a defense-in-depth gate; provider-native secret scanning remains recommended.

roots=()
for candidate in supabase src api scripts; do
  [[ -d "$candidate" ]] && roots+=("$candidate")
done

if [[ ${#roots[@]} -eq 0 ]]; then
  echo "No runtime source roots found; secret gate passes."
  exit 0
fi

# Do not scan this script against its own detection regex literals.
mapfile -t files < <(find "${roots[@]}" -type f \
  ! -path '*/node_modules/*' \
  ! -path '*/.git/*' \
  ! -path 'scripts/check_no_literal_secrets.sh' \
  \( -name '*.sql' -o -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' -o -name '*.json' -o -name '*.mjs' -o -name '*.cjs' -o -name '*.sh' -o -name '*.env' \) \
  -print)

if [[ ${#files[@]} -eq 0 ]]; then
  echo "No scannable runtime files found; secret gate passes."
  exit 0
fi

failed=0
check() {
  local label="$1"
  local pattern="$2"
  if grep -nE "$pattern" "${files[@]}" >/tmp/pandora_secret_hits 2>/dev/null; then
    echo "::error::Potential literal secret detected: $label"
    # Show file/line only, not the matching secret text.
    cut -d: -f1-2 /tmp/pandora_secret_hits | sort -u
    failed=1
  fi
}

check "GitHub token" 'gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}'
check "OpenAI-style secret" 'sk-[A-Za-z0-9_-]{20,}'
check "Supabase secret key" 'sb_secret_[A-Za-z0-9_-]{20,}'
check "JWT literal" 'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}'
check "Private key block" '-----BEGIN ([A-Z0-9 ]+ )?PRIVATE KEY-----'
check "AWS access key" 'AKIA[0-9A-Z]{16}'
check "Slack token" 'xox[baprs]-[A-Za-z0-9-]{10,}'

rm -f /tmp/pandora_secret_hits

if [[ $failed -ne 0 ]]; then
  echo "Literal-secret gate FAILED. Move secrets to Supabase Vault/function secrets or the required bootstrap secret store."
  exit 1
fi

echo "Literal-secret gate passed."
