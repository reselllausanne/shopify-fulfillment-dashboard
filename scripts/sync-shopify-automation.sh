#!/usr/bin/env bash
# Mirror portable_product_upsert code from the deployed GitHub checkout into the
# cron runtime dir (/opt/shopify-automation). Code only: never touches logs/,
# venv/, .env*, caches, partials or cooldown markers living in the target.
#
# Called by vps-deploy-from-github.sh after the web deploy; safe to run by hand:
#   bash scripts/sync-shopify-automation.sh [--dry-run]
set -euo pipefail

SRC="${SHOPIFY_AUTOMATION_SRC:-/opt/resell/portable_product_upsert}"
DST="${SHOPIFY_AUTOMATION_DIR:-/opt/shopify-automation}"
DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

if [[ ! -d "$SRC" || ! -d "$DST" ]]; then
  echo "SHOPIFY_AUTOMATION_SYNC_SKIP src=$SRC dst=$DST (missing dir)"
  exit 0
fi

mapfile -t FILES < <(cd "$SRC" && ls -1 *.py scripts/*.sh 2>/dev/null)
CHANGED=()
for f in "${FILES[@]}"; do
  if ! cmp -s "$SRC/$f" "$DST/$f"; then
    CHANGED+=("$f")
  fi
done

if [[ ${#CHANGED[@]} -eq 0 ]]; then
  echo "SHOPIFY_AUTOMATION_SYNC_OK unchanged"
  exit 0
fi

echo "== shopify-automation changed: ${CHANGED[*]}"
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "SHOPIFY_AUTOMATION_SYNC_DRY_RUN files=${#CHANGED[@]}"
  exit 0
fi

BACKUP="$DST/.deploy-backup/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP/scripts"
for f in "${CHANGED[@]}"; do
  [[ -f "$DST/$f" ]] && cp -p "$DST/$f" "$BACKUP/$f"
done

for f in "${CHANGED[@]}"; do
  mkdir -p "$(dirname "$DST/$f")"
  # Atomic swap so a cron tick never imports a half-written module.
  cp "$SRC/$f" "$DST/$f.tmp-sync"
  mv "$DST/$f.tmp-sync" "$DST/$f"
done
chmod +x "$DST"/scripts/*.sh 2>/dev/null || true

echo "SHOPIFY_AUTOMATION_SYNC_OK files=${#CHANGED[@]} backup=$BACKUP"
