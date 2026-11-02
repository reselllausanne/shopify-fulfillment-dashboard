#!/usr/bin/env bash
#
# Mid-hour light StockX AWB sync (no remint / no autoLink).
# Shares flock with hourly stockx-awb-cron.sh so they never overlap.
#
# Suggested VPS crontab (Europe/Zurich):
#   CRON_TZ=Europe/Zurich
#   */30 * * * * /opt/resell/scripts/stockx-awb-only-cron.sh >> /var/log/resell/stockx-awb-only-cron.log 2>&1
#
# Env overrides:
#   STOCKX_AWB_DAYS / STOCKX_AWB_LIMIT / STOCKX_AWB_BASE_URL / STOCKX_AWB_LOG_DIR
#
set -euo pipefail

DAYS="${STOCKX_AWB_DAYS:-30}"
LIMIT="${STOCKX_AWB_LIMIT:-60}"
BASE_URL="${STOCKX_AWB_BASE_URL:-http://127.0.0.1:3000}"
LOG_DIR="${STOCKX_AWB_LOG_DIR:-/var/log/resell}"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/stockx-awb-sync.log"
LOCK_FILE="/tmp/stockx-awb-sync.lock"
BODY_FILE="/tmp/stockx-awb-only-body.json"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] SKIP awb-only already running (lock $LOCK_FILE)" | tee -a "$LOG_FILE"
  exit 0
fi

: >"$BODY_FILE"
BODY=$(printf '{"days":%s,"limit":%s,"forceRefresh":false,"awbOnly":true}' "$DAYS" "$LIMIT")

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] START stockx-awb-only days=$DAYS limit=$LIMIT" | tee -a "$LOG_FILE"

set +e
T0=$(date +%s)
HTTP=$(curl -sS -o "$BODY_FILE" -w "%{http_code}" \
  -X POST "$BASE_URL/api/admin/stockx-awb-sync" \
  -H "content-type: application/json" \
  -d "$BODY" \
  --max-time 700)
CURL_STATUS=$?
SECS=$(( $(date +%s) - T0 ))
set -e

RESP="$(cat "$BODY_FILE" 2>/dev/null || true)"
if [[ "$CURL_STATUS" -ne 0 || -z "$RESP" ]]; then
  RESP="(empty — curl=$CURL_STATUS http=$HTTP; no stale body)"
fi

NOTE=""
if [[ -n "$(cat "$BODY_FILE" 2>/dev/null || true)" ]]; then
  NOTE=$(python3 - "$BODY_FILE" <<'PY' 2>/dev/null || true
import json,sys
d=json.load(open(sys.argv[1]))
bits=[]
if d.get("budgetExhausted") or d.get("abortedReason")=="budget_exhausted":
  bits.append("partial_budget")
if d.get("abortedReason") and d.get("abortedReason")!="budget_exhausted":
  bits.append("abort="+str(d.get("abortedReason"))[:80])
bits.append("updated="+str(d.get("updated")))
bits.append("elapsedMs="+str(d.get("elapsedMs")))
oa=d.get("opsAlerts") or {}
if oa:
  bits.append("opsAlerts_new="+str(oa.get("newAlerts")))
  bits.append("opsAlerts_emailed="+str(oa.get("emailed")))
print(" ".join(bits))
PY
)
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] awb-only http=$HTTP curl=$CURL_STATUS secs=$SECS ${NOTE} resp=${RESP:0:600}" | tee -a "$LOG_FILE"

if [[ "$CURL_STATUS" -ne 0 || "$HTTP" != "200" ]]; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] DONE stockx-awb-only exit=1" | tee -a "$LOG_FILE"
  exit 1
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] DONE stockx-awb-only exit=0 ${NOTE}" | tee -a "$LOG_FILE"
exit 0
