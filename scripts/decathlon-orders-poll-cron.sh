#!/usr/bin/env bash
#
# Poll Mirakl for new/changed Decathlon orders → local DB mirror.
# Without this, /decathlon/orders only updates when staff clicks "Refresh orders".
#
# Suggested crontab:
#   */10 * * * * /opt/resell/scripts/decathlon-orders-poll-cron.sh
#
set -euo pipefail

cd /opt/resell
LOG_DIR="${DECATHLON_OPS_LOG_DIR:-/var/log/resell}"
LOCK_FILE="/tmp/decathlon-orders-poll-cron.lock"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/decathlon-orders-poll.log"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] SKIP already running (lock $LOCK_FILE)" >> "$LOG_FILE"
  exit 0
fi

{
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] decathlon-orders-poll start"
  docker compose exec -T web npx tsx scripts/run-decathlon-orders-poll.ts
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] decathlon-orders-poll end"
} >> "$LOG_FILE" 2>&1
