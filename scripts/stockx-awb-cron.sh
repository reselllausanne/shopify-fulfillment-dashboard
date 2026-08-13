#!/usr/bin/env bash
#
# Hourly StockX AWB sync (VPS cron).
#
# Hits the web process over localhost so Playwright can reuse the entrypoint Xvfb
# display (true headless is blocked by Cloudflare).
#
# Usage:
#   bash scripts/stockx-awb-cron.sh
#   bash scripts/stockx-awb-cron.sh --force-refresh
#
# Env overrides:
#   STOCKX_AWB_DAYS     default 21
#   STOCKX_AWB_LIMIT    default 60
#   STOCKX_AWB_BASE_URL default http://127.0.0.1:3000
#   STOCKX_AWB_LOG_DIR  default /var/log/resell
#
set -euo pipefail

DAYS="${STOCKX_AWB_DAYS:-21}"
LIMIT="${STOCKX_AWB_LIMIT:-60}"
BASE_URL="${STOCKX_AWB_BASE_URL:-http://127.0.0.1:3000}"
LOG_DIR="${STOCKX_AWB_LOG_DIR:-/var/log/resell}"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/stockx-awb-sync.log"
LOCK_FILE="/tmp/stockx-awb-sync.lock"

FORCE_REFRESH=false
for arg in "$@"; do
  case "$arg" in
    --force-refresh) FORCE_REFRESH=true ;;
  esac
done

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] SKIP already running (lock $LOCK_FILE)" | tee -a "$LOG_FILE"
  exit 0
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] START stockx-awb-sync days=$DAYS limit=$LIMIT forceRefresh=$FORCE_REFRESH" | tee -a "$LOG_FILE"

BODY=$(printf '{"days":%s,"limit":%s,"forceRefresh":%s}' "$DAYS" "$LIMIT" "$FORCE_REFRESH")

set +e
HTTP=$(curl -sS -o /tmp/stockx-awb-sync-body.json -w "%{http_code}" \
  -X POST "$BASE_URL/api/admin/stockx-awb-sync" \
  -H "content-type: application/json" \
  -d "$BODY" \
  --max-time 780)
CURL_STATUS=$?
set -e

RESP="$(cat /tmp/stockx-awb-sync-body.json 2>/dev/null || true)"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] http=$HTTP curl=$CURL_STATUS resp=${RESP:0:800}" | tee -a "$LOG_FILE"

if [[ "$CURL_STATUS" -ne 0 ]]; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] DONE stockx-awb-sync exit=1 (curl failed)" | tee -a "$LOG_FILE"
  exit 1
fi

if [[ "$HTTP" != "200" ]]; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] DONE stockx-awb-sync exit=1 (http $HTTP)" | tee -a "$LOG_FILE"
  exit 1
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] DONE stockx-awb-sync exit=0" | tee -a "$LOG_FILE"
exit 0
