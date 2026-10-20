#!/usr/bin/env bash
#
# One consolidated StockX report for Shopify, Galaxus, and Decathlon.
# Suggested VPS cron (Europe/Zurich): 45 0 * * *
#
set -euo pipefail

BASE_URL="${STOCKX_DAILY_RECAP_BASE_URL:-http://127.0.0.1:3000}"
LOG_DIR="${STOCKX_AWB_LOG_DIR:-/var/log/resell}"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/stockx-daily-recap.log"
LOCK_FILE="/tmp/stockx-daily-recap.lock"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] SKIP already running" | tee -a "$LOG_FILE"
  exit 0
fi

BODY='{"hours":24}'
set +e
HTTP=$(curl -sS -o /tmp/stockx-daily-recap-body.json -w "%{http_code}" \
  -X POST "$BASE_URL/api/admin/stockx-daily-recap" \
  -H "content-type: application/json" \
  -d "$BODY" \
  --max-time 110)
CURL_STATUS=$?
set -e

RESP="$(cat /tmp/stockx-daily-recap-body.json 2>/dev/null || true)"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] http=$HTTP curl=$CURL_STATUS resp=${RESP:0:600}" | tee -a "$LOG_FILE"

if [[ "$CURL_STATUS" -ne 0 || "$HTTP" != "200" ]]; then
  exit 1
fi
