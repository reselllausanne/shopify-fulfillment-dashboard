#!/usr/bin/env bash
# Run full Baby-Walz (bwz) scrape in a one-off container (survives `web` restarts).
# bwz stays in SCRAPER_CRON_SKIP (too long for the shared API batch); schedule this instead:
#   0 6 */7 * * /opt/resell/scripts/run-baby-walz-detached.sh >> /opt/resell/scrape-bwz-cron.log 2>&1
# Usage: /opt/resell/scripts/run-baby-walz-detached.sh [--max=N]
set -euo pipefail
REPO_DIR="${REPO_DIR:-/opt/resell}"
cd "$REPO_DIR"
mkdir -p logs .data
LOG="${REPO_DIR}/logs/bwz-full-$(date -u +%Y%m%dT%H%M%SZ).log"

if docker ps --format '{{.Names}}' | grep -qx resell-bwz-scrape; then
  echo "[$(date -Is)] resell-bwz-scrape already running — skip" | tee -a "$LOG"
  exit 0
fi
docker rm -f resell-bwz-scrape 2>/dev/null || true
for _ in $(seq 1 30); do
  docker ps -a --format '{{.Names}}' | grep -qx resell-bwz-scrape || break
  sleep 2
done

echo "[$(date -Is)] starting detached bwz scrape -> $LOG" | tee -a "$LOG"
nohup docker compose run --name resell-bwz-scrape --rm \
  -e SCRAPER_STALE_RUN_MINUTES="${SCRAPER_STALE_RUN_MINUTES:-1440}" \
  web npx tsx scripts/run-baby-walz-scrape.ts "$@" \
  >>"$LOG" 2>&1 &
echo "[$(date -Is)] pid=$! log=$LOG"
echo "follow: tail -f $LOG"
