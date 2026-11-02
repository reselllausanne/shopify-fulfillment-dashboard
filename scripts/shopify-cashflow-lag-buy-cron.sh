#!/usr/bin/env bash
#
# Daily Shopify cashflow-lag StockX auto-buy (oldest lag-eligible sell-day cohort).
# Uses action=auto_easy_email_rest + useQueue (default lag ~5d via STOCKX_BUY_LAG_DAYS).
#
# Suggested VPS crontab (after Express 09:15 Zurich — set CRON_TZ so 0 10 is local):
#   CRON_TZ=Europe/Zurich
#   0 10 * * * /opt/resell/scripts/shopify-cashflow-lag-buy-cron.sh >> /var/log/resell/shopify-cashflow-lag-buy.log 2>&1
#
# Usage:
#   bash scripts/shopify-cashflow-lag-buy-cron.sh
#   bash scripts/shopify-cashflow-lag-buy-cron.sh --dry-run
#
set -euo pipefail

BASE_URL="${SHOPIFY_CASHFLOW_BUY_BASE_URL:-${STOCKX_AWB_BASE_URL:-http://127.0.0.1:3000}}"
LOG_DIR="${STOCKX_AWB_LOG_DIR:-/var/log/resell}"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/shopify-cashflow-lag-buy.log"
LOCK_FILE="/tmp/shopify-cashflow-lag-buy.lock"
BODY_FILE="/tmp/shopify-cashflow-lag-buy-body.json"

MAX_ORDERS="${SHOPIFY_CASHFLOW_BUY_LIMIT:-40}"
# Optional override; omit from JSON when unset → server getBuyLagDays().
LAG_DAYS="${SHOPIFY_CASHFLOW_BUY_LAG_DAYS:-}"

DRY=false
for a in "$@"; do
  if [[ "$a" == "--dry-run" || "$a" == "--preview" ]]; then DRY=true; fi
done

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] SKIP already running" | tee -a "$LOG_FILE"
  exit 0
fi

: >"$BODY_FILE"

if [[ "$DRY" == "true" ]]; then
  if [[ -n "$LAG_DAYS" ]]; then
    BODY=$(printf '{"action":"auto_easy_email_rest","useQueue":true,"maxOrders":%s,"lagDays":%s,"dryRun":true}' "$MAX_ORDERS" "$LAG_DAYS")
  else
    BODY=$(printf '{"action":"auto_easy_email_rest","useQueue":true,"maxOrders":%s,"dryRun":true}' "$MAX_ORDERS")
  fi
else
  if [[ -n "$LAG_DAYS" ]]; then
    BODY=$(printf '{"action":"auto_easy_email_rest","useQueue":true,"maxOrders":%s,"lagDays":%s,"confirmLive":true}' "$MAX_ORDERS" "$LAG_DAYS")
  else
    BODY=$(printf '{"action":"auto_easy_email_rest","useQueue":true,"maxOrders":%s,"confirmLive":true}' "$MAX_ORDERS")
  fi
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] START cashflow_lag_buy maxOrders=$MAX_ORDERS lagDays=${LAG_DAYS:-default} dry=$DRY" | tee -a "$LOG_FILE"

set +e
HTTP=$(curl -sS -o "$BODY_FILE" -w "%{http_code}" \
  -X POST "$BASE_URL/api/admin/stockx-checkout" \
  -H "content-type: application/json" \
  -d "$BODY" \
  --max-time 900)
CURL_STATUS=$?
set -e

RESP="$(cat "$BODY_FILE" 2>/dev/null || true)"
NOTE=""
if [[ -n "$RESP" ]]; then
  NOTE=$(python3 - "$BODY_FILE" <<'PY' 2>/dev/null || true
import json,sys
d=json.load(open(sys.argv[1]))
s=d.get("summary") or {}
bits=[]
bits.append("bought="+str(s.get("bought")))
bits.append("needsHuman="+str(s.get("emailed") if s.get("emailed") is not None else len(s.get("needsHuman") or [])))
bits.append("skipped="+str(s.get("skipped")))
bits.append("attempted="+str(s.get("attempted")))
bits.append("scanned="+str(s.get("scannedOrders")))
bits.append("dryRun="+str(s.get("dryRun")))
bits.append("emailSent="+str(s.get("emailSent")))
q=s.get("queue") or {}
if q.get("cohortSellDateKey"):
  bits.append("cohort="+str(q.get("cohortSellDateKey")))
if q.get("lagDays") is not None:
  bits.append("lagDays="+str(q.get("lagDays")))
print(" ".join(bits))
PY
)
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] http=$HTTP curl=$CURL_STATUS ${NOTE} resp=${RESP:0:1200}" | tee -a "$LOG_FILE"

if [[ "$CURL_STATUS" -ne 0 || "$HTTP" != "200" ]]; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] DONE exit=1" | tee -a "$LOG_FILE"
  exit 1
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] DONE exit=0 ${NOTE}" | tee -a "$LOG_FILE"
exit 0
