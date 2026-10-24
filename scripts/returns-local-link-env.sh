#!/usr/bin/env bash
# Worktree has no secrets in git — reuse main clone .env / .env.local (symlink).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WT="$ROOT/.worktrees/returns-local"
PORT="${PORT:-3000}"

if [ ! -d "$WT" ]; then
  echo "missing worktree $WT — run dev-returns-localhost.sh first"
  exit 1
fi

link_one() {
  local name="$1"
  if [ -f "$ROOT/$name" ]; then
    ln -sf "$ROOT/$name" "$WT/$name"
    echo "linked $name → worktree"
    return 0
  fi
  echo "warn: $ROOT/$name missing (Shopify/DB calls may fail)"
  return 1
}

link_one .env || true
link_one .env.local || true

# Same-origin /returns on localhost must be allowed for public returnable API.
local_origin="http://localhost:${PORT}"
local_origin_alt="http://127.0.0.1:${PORT}"
export_file="$ROOT/.env.local"
if [ -f "$export_file" ]; then
  if ! grep -q "RETURNS_CORS_ORIGINS=" "$export_file"; then
    printf '\nRETURNS_CORS_ORIGINS=%s,%s\n' "$local_origin" "$local_origin_alt" >>"$export_file"
    echo "appended RETURNS_CORS_ORIGINS to $export_file"
  elif ! grep -q "localhost:${PORT}" "$export_file" && ! grep -q "127.0.0.1:${PORT}" "$export_file"; then
    # Append port to existing comma list (macOS sed: inline)
    perl -i -pe "s/^(RETURNS_CORS_ORIGINS=.*)\$/\$1,${local_origin},${local_origin_alt}/ if /^RETURNS_CORS_ORIGINS=/" "$export_file"
    echo "extended RETURNS_CORS_ORIGINS for port $PORT in $export_file"
  fi
else
  cat >"$export_file" <<EOF
# Local overrides (shared with returns worktree via symlink)
RETURNS_CORS_ORIGINS=${local_origin},${local_origin_alt}
RETURNS_SIZE_FIT_METAFIELD=custom.fit_note
EOF
  ln -sf "$export_file" "$WT/.env.local"
  echo "created $export_file (add Shopify keys in main .env)"
fi
