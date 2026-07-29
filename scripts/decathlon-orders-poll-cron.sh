#!/usr/bin/env bash
#
# Poll Mirakl for new/changed Decathlon orders → local DB mirror.
# Without this, /decathlon/orders only updates when staff clicks "Refresh orders".
#
# Suggested crontab:
#   */10 * * * * /opt/resell/scripts/decathlon-orders-poll-cron.sh
#
set -euo pipefail

BASE_URL="${DECATHLON_OPS_BASE_URL:-http://127.0.0.1:3000}"
LOG_DIR="${DECATHLON_OPS_LOG_DIR:-/var/log/resell}"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/decathlon-orders-poll.log"

resp="$(
  curl -sS --max-time 300 \
    -X POST "$BASE_URL/api/decathlon/orders/poll" \
    -H 'content-type: application/json' 2>&1 || echo '{"ok":false,"error":"curl failed"}'
)"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $resp" >> "$LOG_FILE"
