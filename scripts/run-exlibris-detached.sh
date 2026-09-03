#!/usr/bin/env bash
# Run Ex Libris TS scrape → SupplierVariant (survives `web` restarts).
# Progress: .data/exlibris-scrape-progress.json (migrates legacy Python checkpoint once).
#
# Usage:
#   /opt/resell/scripts/run-exlibris-detached.sh
#   EXLIBRIS_CATALOG=musik_cd /opt/resell/scripts/run-exlibris-detached.sh
set -euo pipefail
REPO_DIR="${REPO_DIR:-/opt/resell}"
cd "$REPO_DIR"
mkdir -p logs .data
LOG="${REPO_DIR}/logs/exl-full-$(date -u +%Y%m%dT%H%M%SZ).log"

docker rm -f resell-exl-scrape resell-exl-import 2>/dev/null || true

echo "[$(date -Is)] starting detached exl TS scrape -> $LOG" | tee -a "$LOG"
nohup docker compose run --name resell-exl-scrape --rm \
  -e SCRAPER_STALE_RUN_MINUTES="${SCRAPER_STALE_RUN_MINUTES:-1440}" \
  -e SCRAPER_EXL_RESUME="${SCRAPER_EXL_RESUME:-1}" \
  -e EXLIBRIS_CATALOG="${EXLIBRIS_CATALOG:-spiele}" \
  -e SCRAPER_EXL_REQUEST_DELAY_MS="${SCRAPER_EXL_REQUEST_DELAY_MS:-400}" \
  -v "${REPO_DIR}/.data:/app/.data" \
  web npx tsx scripts/run-exlibris-scrape.ts \
  >>"$LOG" 2>&1 &
echo "[$(date -Is)] pid=$! log=$LOG"
echo "follow: tail -f $LOG"
echo "progress: ${REPO_DIR}/.data/exlibris-scrape-progress.json"
