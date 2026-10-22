#!/usr/bin/env bash
#
# Hourly StockX AWB sync (VPS cron).
#
# Hits the web process over localhost so Playwright can reuse the entrypoint Xvfb
# display (true headless is blocked by Cloudflare).
#
# Order matters: remint first (own curl budget), then AWB/backfill. Previously a hung
# AWB HTTP call (--max-time 780) could leave overnight force-refresh with an empty body
# even when Chromium had already spent minutes on login.
#
# Usage:
#   bash scripts/stockx-awb-cron.sh
#   bash scripts/stockx-awb-cron.sh --force-refresh
#
# Env overrides:
#   STOCKX_AWB_DAYS     default 45 (recent matches needing AWB/chainId)
#   STOCKX_AWB_LIMIT    default 60
#   STOCKX_AWB_BASE_URL default http://127.0.0.1:3000
#   STOCKX_AWB_LOG_DIR  default /var/log/resell
#
set -euo pipefail

DAYS="${STOCKX_AWB_DAYS:-45}"
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

# 1) Token remint only — always runs, even when forceRefresh=false (near-expiry path inside API).
REFRESH_BODY=$(printf '{"forceRefresh":%s,"refreshOnly":true}' "$FORCE_REFRESH")
set +e
REFRESH_HTTP=$(curl -sS -o /tmp/stockx-awb-refresh-body.json -w "%{http_code}" \
  -X POST "$BASE_URL/api/admin/stockx-awb-sync" \
  -H "content-type: application/json" \
  -d "$REFRESH_BODY" \
  --max-time 560)
REFRESH_CURL=$?
set -e
REFRESH_RESP="$(cat /tmp/stockx-awb-refresh-body.json 2>/dev/null || true)"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] refresh http=$REFRESH_HTTP curl=$REFRESH_CURL resp=${REFRESH_RESP:0:800}" | tee -a "$LOG_FILE"

# 2) AWB / auto-link / status — never force remint again (tokens just written above).
BODY=$(printf '{"days":%s,"limit":%s,"forceRefresh":false}' "$DAYS" "$LIMIT")
set +e
HTTP=$(curl -sS -o /tmp/stockx-awb-sync-body.json -w "%{http_code}" \
  -X POST "$BASE_URL/api/admin/stockx-awb-sync" \
  -H "content-type: application/json" \
  -d "$BODY" \
  --max-time 780)
CURL_STATUS=$?
set -e

RESP="$(cat /tmp/stockx-awb-sync-body.json 2>/dev/null || true)"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] awb http=$HTTP curl=$CURL_STATUS resp=${RESP:0:800}" | tee -a "$LOG_FILE"

if [[ "$REFRESH_CURL" -ne 0 || "$REFRESH_HTTP" != "200" ]]; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] DONE stockx-awb-sync exit=1 (refresh failed)" | tee -a "$LOG_FILE"
  exit 1
fi

if [[ "$CURL_STATUS" -ne 0 ]]; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] DONE stockx-awb-sync exit=1 (awb curl failed; refresh ok)" | tee -a "$LOG_FILE"
  exit 1
fi

if [[ "$HTTP" != "200" ]]; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] DONE stockx-awb-sync exit=1 (awb http $HTTP; refresh ok)" | tee -a "$LOG_FILE"
  exit 1
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] DONE stockx-awb-sync exit=0" | tee -a "$LOG_FILE"
exit 0
