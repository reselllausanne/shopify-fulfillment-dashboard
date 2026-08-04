#!/usr/bin/env bash
# Shopify liquidation convergence (physical qty → price/stock state).
# Runs convergeAll via tsx inside the web container — no HTTP curl to :3000.
set -euo pipefail
cd /opt/resell
LOG=/opt/resell/logs/convergence.log
LOCK_FILE="/tmp/convergence-cron.lock"
mkdir -p /opt/resell/logs

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[$(date -Iseconds)] convergence-cron SKIP already running (lock $LOCK_FILE)" >> "$LOG"
  exit 0
fi

{
  echo "[$(date -Iseconds)] convergence-cron start"
  docker compose exec -T web npx tsx scripts/run-convergence.ts
  echo "[$(date -Iseconds)] convergence-cron end"
} >> "$LOG" 2>&1
