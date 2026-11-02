#!/usr/bin/env bash
#
# Lightweight StockX ops-alerts digest (VPS cron). Independent of autoLink / AWB.
#
# When autoLink times out on the hourly AWB cron, the digest used to be skipped.
# This path only POSTs opsAlertsOnly → runStockxOrderOpsAlerts (cancel/refund/
# delayed/missing-AWB/not-purchased/unlinked across Shopify+Galaxus+Decathlon).
#
# Suggested VPS crontab (Europe/Zurich):
#   CRON_TZ=Europe/Zurich
#   */20 * * * * /opt/resell/scripts/stockx-ops-alerts-cron.sh
#
# Env overrides:
#   STOCKX_AWB_BASE_URL  default http://127.0.0.1:3000
#   STOCKX_AWB_LOG_DIR   default /var/log/resell
#   STOCKX_OPS_ALERT_DAYS default 30
#
set -euo pipefail

DAYS="${STOCKX_OPS_ALERT_DAYS:-30}"
BASE_URL="${STOCKX_AWB_BASE_URL:-http://127.0.0.1:3000}"
LOG_DIR="${STOCKX_AWB_LOG_DIR:-/var/log/resell}"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/stockx-awb-sync.log"
LOCK_FILE="/tmp/stockx-ops-alerts.lock"
BODY_FILE="/tmp/stockx-ops-alerts-body.json"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] SKIP ops-alerts already running" | tee -a "$LOG_FILE"
  exit 0
fi

: >"$BODY_FILE"
BODY=$(printf '{"opsAlertsOnly":true,"days":%s}' "$DAYS")

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] START stockx-ops-alerts days=$DAYS" | tee -a "$LOG_FILE"

set +e
T0=$(date +%s)
HTTP=$(curl -sS -o "$BODY_FILE" -w "%{http_code}" \
  -X POST "$BASE_URL/api/admin/stockx-awb-sync" \
  -H "content-type: application/json" \
  -d "$BODY" \
  --max-time 240)
CURL_STATUS=$?
SECS=$(( $(date +%s) - T0 ))
set -e

RESP="$(cat "$BODY_FILE" 2>/dev/null || true)"
if [[ "$CURL_STATUS" -ne 0 || -z "$RESP" ]]; then
  RESP="(empty — curl=$CURL_STATUS http=$HTTP; no stale body)"
fi

OPS_NOTE=""
if [[ -n "$(cat "$BODY_FILE" 2>/dev/null || true)" ]]; then
  OPS_NOTE=$(python3 - "$BODY_FILE" <<'PY' 2>/dev/null || true
import json,sys
d=json.load(open(sys.argv[1]))
oa=d.get("opsAlerts") or {}
bits=[]
bits.append("newAlerts="+str(oa.get("newAlerts")))
bits.append("emailed="+str(oa.get("emailed")))
bits.append("candidates="+str(oa.get("candidates")))
bt=oa.get("byType") or {}
if bt:
  bits.append("byType="+",".join(f"{k}:{v}" for k,v in bt.items() if v)
)
cm=oa.get("customerMails") or {}
if cm:
  bits.append(
    "custMail=en:%s sent:%s skip:%s rebuy:%s/%s err:%s"
    % (
      cm.get("enabled"),
      cm.get("delaySent"),
      cm.get("delaySkipped"),
      cm.get("cancelRebuyBought"),
      cm.get("cancelRebuyAttempted"),
      cm.get("errors"),
    )
  )
print(" ".join(bits))
PY
)
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ops-alerts http=$HTTP curl=$CURL_STATUS secs=$SECS ${OPS_NOTE} resp=${RESP:0:500}" | tee -a "$LOG_FILE"

if [[ "$CURL_STATUS" -ne 0 || "$HTTP" != "200" ]]; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] DONE stockx-ops-alerts exit=1" | tee -a "$LOG_FILE"
  exit 1
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] DONE stockx-ops-alerts exit=0 ${OPS_NOTE}" | tee -a "$LOG_FILE"
exit 0
