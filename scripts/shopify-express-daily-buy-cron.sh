#!/usr/bin/env bash
#
# Daily Shopify Express → StockX Place Order (lag 0) + ops digest email.
# Suggested VPS cron (Europe/Zurich): every day 09:15
#   15 9 * * * /opt/resell/scripts/shopify-express-daily-buy-cron.sh >> /var/log/resell/shopify-express-daily-buy.log 2>&1
#
set -euo pipefail

BASE_URL="${SHOPIFY_EXPRESS_BUY_BASE_URL:-http://127.0.0.1:3000}"
LOG_DIR="${STOCKX_AWB_LOG_DIR:-/var/log/resell}"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/shopify-express-daily-buy.log"
LOCK_FILE="/tmp/shopify-express-daily-buy.lock"

DAYS="${SHOPIFY_EXPRESS_BUY_DAYS:-14}"
LIMIT="${SHOPIFY_EXPRESS_BUY_LIMIT:-20}"
# Pass --dry-run to classify without Place Order / email.
DRY=false
for a in "$@"; do
  if [[ "$a" == "--dry-run" || "$a" == "--preview" ]]; then DRY=true; fi
done

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] SKIP already running" | tee -a "$LOG_FILE"
  exit 0
fi

if [[ "$DRY" == "true" ]]; then
  BODY=$(printf '{"action":"express_daily_buy","days":%s,"maxOrders":%s,"dryRun":true}' "$DAYS" "$LIMIT")
else
  BODY=$(printf '{"action":"express_daily_buy","days":%s,"maxOrders":%s,"confirmLive":true}' "$DAYS" "$LIMIT")
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] START express_daily_buy days=$DAYS limit=$LIMIT dry=$DRY" | tee -a "$LOG_FILE"

set +e
HTTP=$(curl -sS -o /tmp/shopify-express-daily-buy-body.json -w "%{http_code}" \
  -X POST "$BASE_URL/api/admin/stockx-checkout" \
  -H "content-type: application/json" \
  -d "$BODY" \
  --max-time 900)
CURL_STATUS=$?
set -e

RESP="$(cat /tmp/shopify-express-daily-buy-body.json 2>/dev/null || true)"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] http=$HTTP curl=$CURL_STATUS resp=${RESP:0:1200}" | tee -a "$LOG_FILE"

if [[ "$CURL_STATUS" -ne 0 || "$HTTP" != "200" ]]; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] DONE exit=1" | tee -a "$LOG_FILE"
  exit 1
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] DONE exit=0" | tee -a "$LOG_FILE"
exit 0
