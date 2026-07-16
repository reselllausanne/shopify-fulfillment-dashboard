#!/usr/bin/env bash
#
# Galaxus scheduled ops (VPS cron).
#
# Usage:
#   bash scripts/galaxus-ops-cron.sh full-flow   # stock → price → master-specs (safe sequential)
#   bash scripts/galaxus-ops-cron.sh full-push   # single push-full (heavy; can OOM)
#   bash scripts/galaxus-ops-cron.sh stx-full    # full StockX/KickDB catalog sync
#
# Env overrides:
#   GALAXUS_OPS_BASE_URL   default http://127.0.0.1:3000
#   GALAXUS_OPS_LOG_DIR    default /var/log/resell
#   GALAXUS_OPS_WAIT_SEC   default 3600 (max wait per push step)
#
set -euo pipefail

ACTION="${1:-}"
BASE_URL="${GALAXUS_OPS_BASE_URL:-http://127.0.0.1:3000}"
LOG_DIR="${GALAXUS_OPS_LOG_DIR:-/var/log/resell}"
WAIT_SEC="${GALAXUS_OPS_WAIT_SEC:-3600}"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/galaxus-ops-cron.log"

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG_FILE"
}

post_json() {
  local body="$1"
  local attempt=1
  local max_attempts=5
  local http=""
  local resp=""

  while (( attempt <= max_attempts )); do
    resp="$(
      curl -sS -o /tmp/galaxus-ops-cron-body.json -w "%{http_code}" \
        -X POST "$BASE_URL/api/galaxus/ops/run" \
        -H "content-type: application/json" \
        -d "$body" \
        --max-time 120 || echo "000"
    )"
    http="$resp"
    local text
    text="$(cat /tmp/galaxus-ops-cron-body.json 2>/dev/null || true)"
    log "POST body=$body http=$http resp=${text:0:400}"

    if [[ "$http" == "200" || "$http" == "202" ]]; then
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

wait_feed_idle() {
  local deadline=$((SECONDS + WAIT_SEC))
  while (( SECONDS < deadline )); do
    local active
    # Close runs older than 90m (redeploy kills in-flight jobs without DB cleanup).
    active="$(
      docker compose -f /opt/resell/docker-compose.yml exec -T web node -e '
const {PrismaClient}=require("@prisma/client");
const p=new PrismaClient();
(async()=>{
  const cutoff=new Date(Date.now()-90*60*1000);
  await p.galaxusFeedRun.updateMany({
    where:{finishedAt:null,startedAt:{lt:cutoff}},
    data:{finishedAt:new Date(),success:false,errorMessage:"Stale feed run timed out (cron)"},
  });
  const n=await p.galaxusFeedRun.count({where:{finishedAt:null}});
  process.stdout.write(String(n));
  await p.$disconnect();
})().catch(()=>process.stdout.write("1"));
' 2>/dev/null || echo 1
    )"
    if [[ "$active" == "0" ]]; then
      return 0
    fi
    log "waiting feed idle (active=$active)"
    sleep 30
  done
  log "WARN: timed out waiting for feed idle after ${WAIT_SEC}s; continuing"
  return 0
}

# Ops status exposes feeds.imageSyncRunning (job run startedAt == finishedAt while active).
wait_image_sync_idle() {
  local deadline=$((SECONDS + WAIT_SEC))
  while (( SECONDS < deadline )); do
    local running
    running="$(
      curl -sS --max-time 30 "$BASE_URL/api/galaxus/ops/status" 2>/dev/null \
        | python3 -c 'import json,sys; d=json.load(sys.stdin); print("1" if d.get("feeds",{}).get("imageSyncRunning") else "0")' \
        2>/dev/null || echo 0
    )"
    if [[ "$running" == "0" ]]; then
      return 0
    fi
    log "waiting image-sync idle"
    sleep 30
  done
  log "WARN: timed out waiting for image-sync after ${WAIT_SEC}s; continuing feeds"
  return 0
}

run_push() {
  local action_name="$1"
  log "START push step=$action_name"
  wait_feed_idle || true
  post_json "{\"action\":\"$action_name\"}" >/dev/null
  wait_feed_idle
  log "DONE push step=$action_name"
}

run_image_sync_full() {
  log "START image-sync full"
  wait_image_sync_idle || true
  post_json '{"action":"image-sync","imageMode":"full"}' >/dev/null
  wait_image_sync_idle
  log "DONE image-sync full"
}

if [[ -z "$ACTION" ]]; then
  log "ERROR: missing action (full-flow | full-push | stx-full)"
  exit 2
fi

cd /opt/resell

case "$ACTION" in
  full-flow)
    # Host images first so master MainImageUrl is present, then stock → price → master.
    # Partner-admin no longer runs inline full (broken); cron is the reliable nightly path.
    run_image_sync_full
    run_push "push-stock"
    run_push "push-price"
    run_push "push-master-specs"
    log "DONE full-flow"
    ;;
  full-push)
    log "START action=full-push"
    post_json '{"action":"push-full"}' >/dev/null
    wait_feed_idle || true
    log "DONE action=full-push"
    ;;
  stx-full)
    log "START action=stx-full"
    post_json '{"action":"stx-refresh","stxMode":"full"}' >/dev/null
    log "DONE action=stx-full (async job accepted)"
    ;;
  *)
    log "ERROR: unknown action '$ACTION'"
    exit 2
    ;;
esac

exit 0
