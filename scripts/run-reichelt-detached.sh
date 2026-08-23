#!/usr/bin/env bash
# Run full Reichelt scrape in a one-off container (survives `web` restarts).
# Usage: /opt/resell/scripts/run-reichelt-detached.sh
set -euo pipefail
REPO_DIR="${REPO_DIR:-/opt/resell}"
cd "$REPO_DIR"
mkdir -p logs .data
LOG="${REPO_DIR}/logs/rei-full-$(date -u +%Y%m%dT%H%M%SZ).log"

docker rm -f resell-rei-scrape 2>/dev/null || true

echo "[$(date -Is)] starting detached rei scrape -> $LOG" | tee -a "$LOG"
# nohup + compose run (not exec into web) so web recreate cannot kill the job
nohup docker compose run --name resell-rei-scrape --rm \
  -e SCRAPER_STALE_RUN_MINUTES="${SCRAPER_STALE_RUN_MINUTES:-1440}" \
  -e SCRAPER_REI_RESUME="${SCRAPER_REI_RESUME:-1}" \
  -e SCRAPER_REI_FORCE_CURL=1 \
  -e SCRAPER_REI_PROXY_FILE=/app/.data/reichelt-proxies.txt \
  web npx tsx scripts/run-reichelt-scrape.ts \
  >>"$LOG" 2>&1 &
echo "[$(date -Is)] pid=$! log=$LOG"
echo "follow: tail -f $LOG"
