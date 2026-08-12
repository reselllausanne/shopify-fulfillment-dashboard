#!/usr/bin/env bash
#
# Decathlon scheduled ops (VPS cron).
#
# Usage:
#   bash scripts/decathlon-ops-cron.sh daily-catalog   # P41 physical → OF01 physical
#   bash scripts/decathlon-ops-cron.sh product-sync    # legacy full P41
#   bash scripts/decathlon-ops-cron.sh physical-product-sync  # P41 Bussigny/Lab/Rare only
#   bash scripts/decathlon-ops-cron.sh offer-sync      # legacy full OF01
#   bash scripts/decathlon-ops-cron.sh physical-offer-sync  # physical location stock OF01
#
# Suggested crontab (after Galaxus full-flow ~04:30 UTC):
#   0 5 * * * /opt/resell/scripts/decathlon-ops-cron.sh daily-catalog
#   0 1 * * * /opt/resell/scripts/decathlon-ops-cron.sh physical-product-sync
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
CRON_TOKEN="${DECATHLON_OPS_CRON_TOKEN:-}"

if [[ -z "$CRON_TOKEN" && -f /opt/resell/.env ]]; then
  CRON_TOKEN="$(awk -F= '/^DECATHLON_OPS_CRON_TOKEN=/{print substr($0, index($0, "=") + 1); exit}' /opt/resell/.env)"
fi

if [[ -z "$CRON_TOKEN" ]]; then
  echo "DECATHLON_OPS_CRON_TOKEN is required" >&2
  exit 2
fi

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
        -H "x-decathlon-ops-token: $CRON_TOKEN" \
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
  log "ERROR: missing action (daily-catalog | product-sync | physical-product-sync | offer-sync | physical-offer-sync)"
  exit 2
fi

cd /opt/resell

case "$ACTION" in
  daily-catalog)
    # Bussigny + Lab + Rare (COLD BIEN): onboard products then publish offers.
    run_step "physical-product-sync"
    run_step "physical-offer-sync"
    log "DONE daily-catalog"
    ;;
  product-sync)
    run_step "product-sync"
    log "DONE product-sync"
    ;;
  physical-product-sync)
    run_step "physical-product-sync"
    log "DONE physical-product-sync"
    ;;
  offer-sync)
    run_step "offer-sync"
    log "DONE offer-sync"
    ;;
  physical-offer-sync)
    run_step "physical-offer-sync"
    log "DONE physical-offer-sync"
    ;;
  *)
    log "ERROR: unknown action '$ACTION'"
    exit 2
    ;;
esac

exit 0
