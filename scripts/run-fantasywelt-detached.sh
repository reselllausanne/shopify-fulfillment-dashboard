#!/usr/bin/env bash
# Run full FantasyWelt scrape in a one-off container (survives `web` restarts).
# Usage: /opt/resell/scripts/run-fantasywelt-detached.sh
# Optional: MAX=50 /opt/resell/scripts/run-fantasywelt-detached.sh
set -euo pipefail
REPO_DIR="${REPO_DIR:-/opt/resell}"
cd "$REPO_DIR"
mkdir -p logs .data
LOG="${REPO_DIR}/logs/fan-full-$(date -u +%Y%m%dT%H%M%SZ).log"
MAX_ARG=""
if [ -n "${MAX:-}" ]; then
  MAX_ARG="--max=${MAX}"
fi

docker rm -f resell-fan-scrape 2>/dev/null || true

echo "[$(date -Is)] starting detached fan scrape -> $LOG" | tee -a "$LOG"
# nohup + compose run (not exec into web) so web recreate cannot kill the job
nohup docker compose run --name resell-fan-scrape --rm \
  -e SCRAPER_STALE_RUN_MINUTES="${SCRAPER_STALE_RUN_MINUTES:-1440}" \
  -e SCRAPER_FAN_RESUME="${SCRAPER_FAN_RESUME:-1}" \
  -e SCRAPER_FAN_DEFER_IMAGE_SYNC="${SCRAPER_FAN_DEFER_IMAGE_SYNC:-1}" \
  -e SCRAPER_FAN_HEADED="${SCRAPER_FAN_HEADED:-1}" \
  -e SCRAPER_FAN_USE_REI_PROXIES="${SCRAPER_FAN_USE_REI_PROXIES:-1}" \
  -e SCRAPER_FAN_PROGRESS_FILE=/app/.data/fantasywelt-scrape-progress.json \
  -e SCRAPER_REI_PROXY_FILE="${SCRAPER_REI_PROXY_FILE:-/app/.data/reichelt-proxies.txt}" \
  -e DISPLAY=:99 \
  -e PLAYWRIGHT_USE_XVFB=1 \
  web npx tsx scripts/run-fantasywelt-scrape.ts ${MAX_ARG} \
  >>"$LOG" 2>&1 &
echo "[$(date -Is)] pid=$! log=$LOG"
echo "follow: tail -f $LOG"
