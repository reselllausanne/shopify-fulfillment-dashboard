#!/usr/bin/env bash
#
# Galaxus scheduled ops (VPS cron).
#
# Usage:
#   bash scripts/galaxus-ops-cron.sh full-push
#   bash scripts/galaxus-ops-cron.sh stx-full
#
# Env overrides:
#   GALAXUS_OPS_BASE_URL   default http://127.0.0.1:3000
#   GALAXUS_OPS_LOG_DIR    default /var/log/resell
#
set -euo pipefail

ACTION="${1:-}"
BASE_URL="${GALAXUS_OPS_BASE_URL:-http://127.0.0.1:3000}"
LOG_DIR="${GALAXUS_OPS_LOG_DIR:-/var/log/resell}"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/galaxus-ops-cron.log"
STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

log() {
  echo "[$STAMP] $*" | tee -a "$LOG_FILE"
}

if [[ -z "$ACTION" ]]; then
  log "ERROR: missing action (full-push | stx-full)"
  exit 2
fi

case "$ACTION" in
  full-push)
    BODY='{"action":"push-full"}'
    ;;
  stx-full)
    BODY='{"action":"stx-refresh","stxMode":"full"}'
    ;;
  *)
    log "ERROR: unknown action '$ACTION' (full-push | stx-full)"
    exit 2
    ;;
esac

log "START action=$ACTION url=$BASE_URL/api/galaxus/ops/run"

HTTP_CODE="$(
  curl -sS -o /tmp/galaxus-ops-cron-body.json -w "%{http_code}" \
    -X POST "$BASE_URL/api/galaxus/ops/run" \
    -H "content-type: application/json" \
    -d "$BODY" \
    --max-time 120 || echo "000"
)"

BODY_TEXT="$(cat /tmp/galaxus-ops-cron-body.json 2>/dev/null || true)"
log "DONE action=$ACTION http=$HTTP_CODE body=${BODY_TEXT:0:500}"

if [[ "$HTTP_CODE" != "200" && "$HTTP_CODE" != "202" ]]; then
  exit 1
fi
exit 0
