#!/usr/bin/env bash
#
# Hourly StockX AWB sync (VPS cron).
#
# Pulls tracking numbers for parcels still in transit to the warehouse so scans always find a label.
# Refreshes the StockX bearer from the persistent browser profile when it is near expiry.
#
# Usage:
#   bash scripts/stockx-awb-cron.sh            # hourly sync
#   bash scripts/stockx-awb-cron.sh --force-refresh   # mint a new bearer even if the stored one is valid
#
# Env overrides:
#   STOCKX_AWB_DAYS     default 21  (how far back to look for missing AWBs)
#   STOCKX_AWB_LIMIT    default 60  (max orders per run)
#   STOCKX_AWB_LOG_DIR  default /var/log/resell
#
set -euo pipefail

DAYS="${STOCKX_AWB_DAYS:-21}"
LIMIT="${STOCKX_AWB_LIMIT:-60}"
LOG_DIR="${STOCKX_AWB_LOG_DIR:-/var/log/resell}"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/stockx-awb-sync.log"
LOCK_FILE="/tmp/stockx-awb-sync.lock"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] SKIP already running (lock $LOCK_FILE)" | tee -a "$LOG_FILE"
  exit 0
fi

cd /opt/resell

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] START stockx-awb-sync days=$DAYS limit=$LIMIT $*" | tee -a "$LOG_FILE"

set +e
docker compose exec -T web npx tsx scripts/stockx-awb-sync.ts \
  "--days=$DAYS" "--limit=$LIMIT" "$@" 2>&1 | tee -a "$LOG_FILE"
status="${PIPESTATUS[0]}"
set -e

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] DONE stockx-awb-sync exit=$status" | tee -a "$LOG_FILE"
exit "$status"
