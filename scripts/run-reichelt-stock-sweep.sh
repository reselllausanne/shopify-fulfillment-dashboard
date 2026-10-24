#!/usr/bin/env bash
# Daily REI in-stock refresh only (no full sitemap). Safe under rate limits.
# Pair with weekly run-reichelt-detached.sh for discovery of new SKUs.
#
# Cron (VPS):
#   30 4 * * * /opt/resell/scripts/run-reichelt-stock-sweep.sh >> /opt/resell/scrape-rei-stock-cron.log 2>&1
set -euo pipefail
REPO_DIR="${REPO_DIR:-/opt/resell}"
cd "$REPO_DIR"
mkdir -p logs .data
LOG="${REPO_DIR}/logs/rei-stock-$(date -u +%Y%m%dT%H%M%SZ).log"

if [ "$(docker inspect -f '{{.State.Running}}' resell-rei-scrape 2>/dev/null)" = "true" ]; then
  echo "[$(date -Is)] full rei scrape still running — skip stock sweep" | tee -a "$LOG"
  exit 0
fi
if [ "$(docker inspect -f '{{.State.Running}}' resell-rei-stock-sweep 2>/dev/null)" = "true" ]; then
  echo "[$(date -Is)] rei stock sweep still running — skip" | tee -a "$LOG"
  exit 0
fi
docker rm -f resell-rei-stock-sweep 2>/dev/null || true

echo "[$(date -Is)] starting rei stock-sweep-only -> $LOG" | tee -a "$LOG"
nohup docker compose run --name resell-rei-stock-sweep --rm \
  -e SCRAPER_REI_STOCK_SWEEP_ONLY=1 \
  -e SCRAPER_REI_STALE_SWEEP=1 \
  -e SCRAPER_REI_STALE_DAYS="${SCRAPER_REI_STALE_DAYS:-0.25}" \
  -e SCRAPER_REI_FORCE_CURL=1 \
  -e SCRAPER_REI_PROXY_FILE=/app/.data/reichelt-proxies.txt \
  web npx tsx scripts/run-reichelt-scrape.ts \
  >>"$LOG" 2>&1 &
echo "[$(date -Is)] pid=$! log=$LOG"
