#!/usr/bin/env bash
# Poll Python CSV export and upsert new Ex Libris rows into SupplierVariant.
set -euo pipefail
REPO_DIR="${REPO_DIR:-/opt/resell}"
cd "$REPO_DIR"
INTERVAL="${EXLIBRIS_IMPORT_INTERVAL_SEC:-90}"

echo "[$(date -Is)] exl csv import loop every ${INTERVAL}s"
while true; do
  docker compose run --rm \
    -v "${REPO_DIR}/app/lib:/app/app/lib:ro" \
    -v "${REPO_DIR}/scripts:/app/scripts:ro" \
    -v "${REPO_DIR}/.data/exlibris:/app/.data/exlibris" \
    -v "${REPO_DIR}/.data:/app/.data" \
    web npx tsx scripts/import-exlibris-csv.ts \
    --csv=/app/.data/exlibris/exlibris_products.csv \
    --state=/app/.data/exlibris-import-state.json \
    2>&1 | sed "s/^/[$(date -Is)] /" || true
  sleep "$INTERVAL"
done
