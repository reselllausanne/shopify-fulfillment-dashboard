#!/usr/bin/env bash
#
# Daily GOAT cookie AWB + Shopify match (VPS cron). Cookie only — no Playwright.
#
# Usage:
#   bash scripts/goat-awb-cron.sh
#
# Env:
#   GOAT_AWB_DAYS     default 21
#   GOAT_AWB_LIMIT    default 200
#   GOAT_AWB_BASE_URL default http://127.0.0.1:3000
#   GOAT_AWB_LOG_DIR  default /var/log/resell
#
set -euo pipefail

DAYS="${GOAT_AWB_DAYS:-21}"
LIMIT="${GOAT_AWB_LIMIT:-200}"
BASE_URL="${GOAT_AWB_BASE_URL:-http://127.0.0.1:3000}"
LOG_DIR="${GOAT_AWB_LOG_DIR:-/var/log/resell}"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/goat-awb-sync.log"
LOCK_FILE="/tmp/goat-awb-sync.lock"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] SKIP already running (lock $LOCK_FILE)" | tee -a "$LOG_FILE"
  exit 0
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] START goat-awb-sync days=$DAYS limit=$LIMIT" | tee -a "$LOG_FILE"

BODY=$(printf '{"days":%s,"limit":%s}' "$DAYS" "$LIMIT")

set +e
HTTP=$(curl -sS -o /tmp/goat-awb-sync-body.json -w "%{http_code}" \
  -X POST "$BASE_URL/api/admin/goat-awb-sync" \
  -H "content-type: application/json" \
  -d "$BODY" \
  --max-time 780)
CURL_STATUS=$?
set -e

RESP="$(cat /tmp/goat-awb-sync-body.json 2>/dev/null || true)"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] http=$HTTP curl=$CURL_STATUS resp=${RESP:0:800}" | tee -a "$LOG_FILE"

if [[ "$CURL_STATUS" -ne 0 || "$HTTP" != "200" ]]; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] DONE goat-awb-sync exit=1" | tee -a "$LOG_FILE"
  exit 1
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] DONE goat-awb-sync exit=0" | tee -a "$LOG_FILE"
exit 0
