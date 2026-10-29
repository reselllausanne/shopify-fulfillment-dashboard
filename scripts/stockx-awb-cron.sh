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

DAYS="${STOCKX_AWB_DAYS:-30}"
LIMIT="${STOCKX_AWB_LIMIT:-60}"
BASE_URL="${STOCKX_AWB_BASE_URL:-http://127.0.0.1:3000}"
LOG_DIR="${STOCKX_AWB_LOG_DIR:-/var/log/resell}"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/stockx-awb-sync.log"
LOCK_FILE="/tmp/stockx-awb-sync.lock"
REFRESH_BODY_FILE="/tmp/stockx-awb-refresh-body.json"
LINK_BODY_FILE="/tmp/stockx-awb-link-body.json"
AWB_BODY_FILE="/tmp/stockx-awb-sync-body.json"

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

# Wipe body files BEFORE curl so a timeout never re-logs a days-old Turnstile JSON
# (seen 2026-10-24 → 2026-10-29: awb http=000 while cat'ing Oct-24 body).
: >"$REFRESH_BODY_FILE"
: >"$LINK_BODY_FILE"
: >"$AWB_BODY_FILE"

# 1) Token remint only — always runs, even when forceRefresh=false
#    (near-expiry <6h + keep-alive every 4h while JWT still valid — see lib/stockxSessionRefresh.ts).
#    Two accounts × cookie-first Turnstile wait can exceed 10 minutes; do not starve remint.
REFRESH_BODY=$(printf '{"forceRefresh":%s,"refreshOnly":true}' "$FORCE_REFRESH")
set +e
REFRESH_HTTP=$(curl -sS -o "$REFRESH_BODY_FILE" -w "%{http_code}" \
  -X POST "$BASE_URL/api/admin/stockx-awb-sync" \
  -H "content-type: application/json" \
  -d "$REFRESH_BODY" \
  --max-time 900)
REFRESH_CURL=$?
set -e
REFRESH_RESP="$(cat "$REFRESH_BODY_FILE" 2>/dev/null || true)"
if [[ "$REFRESH_CURL" -ne 0 || -z "$REFRESH_RESP" ]]; then
  REFRESH_RESP="(empty — curl=$REFRESH_CURL http=$REFRESH_HTTP; no stale body)"
fi
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] refresh http=$REFRESH_HTTP curl=$REFRESH_CURL resp=${REFRESH_RESP:0:800}" | tee -a "$LOG_FILE"

# refreshOnly must be HTTP 200 AND JSON ok=true (both accounts). Partial JSON with
# galaxus dead used to return 200 under OR-ok — catch that in the body too.
REFRESH_JSON_OK=0
if [[ "$REFRESH_CURL" -eq 0 && "$REFRESH_HTTP" == "200" && -n "$(cat "$REFRESH_BODY_FILE" 2>/dev/null || true)" ]]; then
  if python3 - "$REFRESH_BODY_FILE" <<'PY'
import json,sys
p=sys.argv[1]
try:
  d=json.load(open(p))
except Exception:
  sys.exit(2)
ok=bool(d.get("ok"))
ref=d.get("refresh") or {}
gal=d.get("galaxusRefresh")
if not ok or not ref.get("ok"):
  sys.exit(1)
if gal is not None and not gal.get("ok"):
  sys.exit(1)
sys.exit(0)
PY
  then
    REFRESH_JSON_OK=1
  fi
fi

# 1.5) Auto-link only — link Galaxus + Shopify orders to their StockX buys.
#      Own curl so a hung AWB backfill (step 2) can never starve linking. Tokens are
#      valid from step 1; no browser/remint here.
LINK_BODY='{"autoLinkOnly":true,"forceRefresh":false}'
set +e
LINK_HTTP=$(curl -sS -o "$LINK_BODY_FILE" -w "%{http_code}" \
  -X POST "$BASE_URL/api/admin/stockx-awb-sync" \
  -H "content-type: application/json" \
  -d "$LINK_BODY" \
  --max-time 700)
LINK_CURL=$?
set -e
LINK_RESP="$(cat "$LINK_BODY_FILE" 2>/dev/null || true)"
if [[ "$LINK_CURL" -ne 0 || -z "$LINK_RESP" ]]; then
  LINK_RESP="(empty — curl=$LINK_CURL http=$LINK_HTTP; no stale body)"
fi
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] autolink http=$LINK_HTTP curl=$LINK_CURL resp=${LINK_RESP:0:600}" | tee -a "$LOG_FILE"

# 2) AWB / status — never force remint again (tokens just written above).
BODY=$(printf '{"days":%s,"limit":%s,"forceRefresh":false}' "$DAYS" "$LIMIT")
set +e
HTTP=$(curl -sS -o "$AWB_BODY_FILE" -w "%{http_code}" \
  -X POST "$BASE_URL/api/admin/stockx-awb-sync" \
  -H "content-type: application/json" \
  -d "$BODY" \
  --max-time 780)
CURL_STATUS=$?
set -e

RESP="$(cat "$AWB_BODY_FILE" 2>/dev/null || true)"
if [[ "$CURL_STATUS" -ne 0 || -z "$RESP" ]]; then
  RESP="(empty — curl=$CURL_STATUS http=$HTTP; no stale body)"
fi
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] awb http=$HTTP curl=$CURL_STATUS resp=${RESP:0:800}" | tee -a "$LOG_FILE"

if [[ "$REFRESH_CURL" -ne 0 || "$REFRESH_HTTP" != "200" || "$REFRESH_JSON_OK" -ne 1 ]]; then
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
