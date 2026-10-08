#!/usr/bin/env bash
# Re-check Reichelt in-stock rows that sell out fast (limited qty / high price) + any
# row older than SCRAPER_REI_STALE_DAYS. No sitemap crawl. Skips if a rei run is active.
# Usage: /opt/resell/scripts/run-reichelt-sweep-detached.sh
set -euo pipefail
REPO_DIR="${REPO_DIR:-/opt/resell}"
cd "$REPO_DIR"
mkdir -p logs .data
LOG="${REPO_DIR}/logs/rei-sweep-$(date -u +%Y%m%dT%H%M%SZ).log"

if docker ps --format '{{.Names}}' | grep -qx 'resell-rei-scrape\|resell-rei-sweep'; then
  echo "[$(date -Is)] rei scrape/sweep already running — skip" | tee -a "$LOG"
  exit 0
fi

echo "[$(date -Is)] starting detached rei sweep -> $LOG" | tee -a "$LOG"
nohup docker compose run --name resell-rei-sweep --rm \
  -e SCRAPER_REI_FORCE_CURL=1 \
  -e SCRAPER_REI_PROXY_FILE=/app/.data/reichelt-proxies.txt \
  -e SCRAPER_REI_STALE_DAYS="${SCRAPER_REI_STALE_DAYS_FULL:-3}" \
  -e SCRAPER_REI_PRIORITY_STALE_HOURS="${SCRAPER_REI_PRIORITY_STALE_HOURS:-6}" \
  web npx tsx scripts/run-reichelt-scrape.ts --sweep-only \
  >>"$LOG" 2>&1 &
echo "[$(date -Is)] pid=$! log=$LOG"
