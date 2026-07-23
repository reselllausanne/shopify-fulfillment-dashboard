#!/usr/bin/env bash
#
# Decathlon scheduled ops (VPS cron).
#
# Usage:
#   bash scripts/decathlon-ops-cron.sh daily-catalog   # P41 product → OF01 offer (sequential)
#   bash scripts/decathlon-ops-cron.sh product-sync    # P41 only
#   bash scripts/decathlon-ops-cron.sh offer-sync      # OF01 only
#
# Suggested crontab (after Galaxus full-flow ~04:30 UTC):
#   0 5 * * * /opt/resell/scripts/decathlon-ops-cron.sh daily-catalog
#
# Env overrides:
#   DECATHLON_OPS_BASE_URL   default http://127.0.0.1:3000
#   DECATHLON_OPS_LOG_DIR    default /var/log/resell
#   DECATHLON_OPS_CURL_MAX   default 7200 (seconds per HTTP call; P41 can poll Mirakl)
#
set -euo pipefail

ACTION="${1:-}"
BASE_URL="${DECATHLON_OPS_BASE_URL:-http://127.0.0.1:3000}"
LOG_DIR="${DECATHLON_OPS_LOG_DIR:-/var/log/resell}"
CURL_MAX="${DECATHLON_OPS_CURL_MAX:-7200}"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/decathlon-ops-cron.log"

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG_FILE"
}

post_json() {
  local body="$1"
  local attempt=1
  local max_attempts=3
  local http=""
  local resp=""

  while (( attempt <= max_attempts )); do
    resp="$(
      curl -sS -o /tmp/decathlon-ops-cron-body.json -w "%{http_code}" \
        -X POST "$BASE_URL/api/decathlon/ops/run" \
        -H "content-type: application/json" \
        -d "$body" \
        --max-time "$CURL_MAX" || echo "000"
    )"
    http="$resp"
    local text
    text="$(cat /tmp/decathlon-ops-cron-body.json 2>/dev/null || true)"
    log "POST body=$body http=$http resp=${text:0:400}"

    if [[ "$http" == "200" ]]; then
      echo "$text"
      return 0
    fi
    if [[ "$http" == "409" ]]; then
      log "lock busy — retry $attempt/$max_attempts in 60s"
      sleep 60
      attempt=$((attempt + 1))
      continue
    fi
    return 1
  done
  return 1
}

run_step() {
  local action_name="$1"
  log "START step=$action_name"
  post_json "{\"action\":\"$action_name\"}" >/dev/null
  log "DONE step=$action_name"
}

if [[ -z "$ACTION" ]]; then
  log "ERROR: missing action (daily-catalog | product-sync | offer-sync)"
  exit 2
fi

cd /opt/resell

case "$ACTION" in
  daily-catalog)
    run_step "product-sync"
    run_step "offer-sync"
    log "DONE daily-catalog"
    ;;
  product-sync)
    run_step "product-sync"
    log "DONE product-sync"
    ;;
  offer-sync)
    run_step "offer-sync"
    log "DONE offer-sync"
    ;;
  *)
    log "ERROR: unknown action '$ACTION'"
    exit 2
    ;;
esac

exit 0
