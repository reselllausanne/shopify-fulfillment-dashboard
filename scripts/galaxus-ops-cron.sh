#!/usr/bin/env bash
#
# Galaxus scheduled ops (VPS cron).
#
# Usage:
#   bash scripts/galaxus-ops-cron.sh full-flow   # stock → price → master-specs (safe sequential)
#   bash scripts/galaxus-ops-cron.sh full-push   # single push-full (heavy; can OOM)
#   bash scripts/galaxus-ops-cron.sh stx-full    # full StockX/KickDB catalog sync
#   bash scripts/galaxus-ops-cron.sh push-master-specs  # master+specs only (recovery)
#
# Env overrides:
#   GALAXUS_OPS_BASE_URL   default http://127.0.0.1:3000
#   GALAXUS_OPS_LOG_DIR    default /var/log/resell
#   GALAXUS_OPS_WAIT_SEC            default 3600 (stock/price max wait)
#   GALAXUS_OPS_MASTER_WAIT_SEC     default 14400 (master-specs max wait; export+SFTP is slow)
#   GALAXUS_OPS_IMAGE_SYNC_WAIT_SEC default 5400 (max wait for image-sync before feeds; ~90m)
#   GALAXUS_OPS_IMAGE_SYNC_BLOCK_FEEDS default 0 — when 1, abort full-flow if image-sync still busy
#   GALAXUS_OPS_SNAPSHOT_WAIT_SEC     default 4500 (max wait for async snapshot rebuild; ~75m — rebuild often 35–45m)
#   GALAXUS_OPS_MASTER_NONBLOCKING    default 1 — full-flow WARN+continue if master-specs fails
#
set -euo pipefail

ACTION="${1:-}"
BASE_URL="${GALAXUS_OPS_BASE_URL:-http://127.0.0.1:3000}"
LOG_DIR="${GALAXUS_OPS_LOG_DIR:-/var/log/resell}"
WAIT_SEC="${GALAXUS_OPS_WAIT_SEC:-3600}"
MASTER_WAIT_SEC="${GALAXUS_OPS_MASTER_WAIT_SEC:-14400}"
IMAGE_SYNC_WAIT_SEC="${GALAXUS_OPS_IMAGE_SYNC_WAIT_SEC:-5400}"
IMAGE_SYNC_BLOCK_FEEDS="${GALAXUS_OPS_IMAGE_SYNC_BLOCK_FEEDS:-0}"
SNAPSHOT_WAIT_SEC="${GALAXUS_OPS_SNAPSHOT_WAIT_SEC:-4500}"
MASTER_NONBLOCKING="${GALAXUS_OPS_MASTER_NONBLOCKING:-1}"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/galaxus-ops-cron.log"
LOCK_FILE="/tmp/galaxus-ops-cron.lock"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] SKIP already running (lock $LOCK_FILE)" | tee -a "$LOG_FILE"
  exit 0
fi

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG_FILE"
}

feed_scope_for_action() {
  case "$1" in
    push-stock) echo "stock" ;;
    push-price) echo "price" ;;
    push-master-specs) echo "master-specs" ;;
    push-full) echo "full" ;;
    *) echo "" ;;
  esac
}

post_json() {
  local body="$1"
  local attempt=1
  local max_attempts=12
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

# Count in-flight feed runs only — never mark runs stale while waiting (that killed nightly master).
count_active_feed_runs() {
  docker compose -f /opt/resell/docker-compose.yml exec -T web node -e '
const {PrismaClient}=require("@prisma/client");
const p=new PrismaClient();
(async()=>{
  const n=await p.galaxusFeedRun.count({where:{finishedAt:null}});
  process.stdout.write(String(n));
  await p.$disconnect();
})().catch(()=>process.stdout.write("1"));
' 2>/dev/null || echo 1
}

wait_feed_idle() {
  local max_wait="${1:-$WAIT_SEC}"
  local deadline=$((SECONDS + max_wait))
  while (( SECONDS < deadline )); do
    local active
    active="$(count_active_feed_runs)"
    if [[ "$active" == "0" ]]; then
      return 0
    fi
    log "waiting feed idle (active=$active, max=${max_wait}s)"
    sleep 30
  done
  log "ERROR: timed out waiting for feed idle after ${max_wait}s"
  return 1
}

# Wait until a successful feed run for scope started after step began (handles queued master behind stock).
wait_scope_success() {
  local scope="$1"
  local since_iso="$2"
  local max_wait="${3:-$WAIT_SEC}"
  local deadline=$((SECONDS + max_wait))
  while (( SECONDS < deadline )); do
    local result
    result="$(
      docker compose -f /opt/resell/docker-compose.yml exec -T web node -e "
const {PrismaClient}=require('@prisma/client');
const p=new PrismaClient();
(async()=>{
  const since=new Date(process.argv[1]);
  const scope=process.argv[2];
  const run=await p.galaxusFeedRun.findFirst({
    where:{scope, startedAt:{gte:since}},
    orderBy:{startedAt:'desc'},
  });
  if(!run){process.stdout.write('pending');return;}
  if(!run.finishedAt){process.stdout.write('running');return;}
  process.stdout.write(run.success?'ok':'fail:'+(run.errorMessage||'unknown'));
  await p.\$disconnect();
})().catch(e=>{process.stdout.write('err:'+e.message);});
" "$since_iso" "$scope" 2>/dev/null || echo "err"
    )"
    case "$result" in
      ok)
        return 0
        ;;
      fail:*)
        log "ERROR: feed scope=$scope failed: ${result#fail:}"
        return 1
        ;;
      pending|running)
        log "waiting scope=$scope status=$result elapsed=$((max_wait - (deadline - SECONDS)))s"
        sleep 30
        ;;
      *)
        log "WARN: scope=$scope poll=$result"
        sleep 30
        ;;
    esac
  done
  log "ERROR: timed out waiting for successful scope=$scope after ${max_wait}s (since=$since_iso)"
  return 1
}

wait_feed_snapshot_rebuild() {
  local since_iso="$1"
  local max_wait="${2:-$SNAPSHOT_WAIT_SEC}"
  local deadline=$((SECONDS + max_wait))
  while (( SECONDS < deadline )); do
    local result
    result="$(
      docker compose -f /opt/resell/docker-compose.yml exec -T web node -e "
const {PrismaClient}=require('@prisma/client');
const p=new PrismaClient();
(async()=>{
  const since=new Date(process.argv[1]);
  const run=await p.galaxusJobRun.findFirst({
    where:{jobName:'ops-feed-snapshot-rebuild', startedAt:{gte:since}},
    orderBy:{startedAt:'desc'},
  });
  if(!run){process.stdout.write('pending');return;}
  const startedMs=new Date(run.startedAt).getTime();
  const finishedMs=new Date(run.finishedAt).getTime();
  if(finishedMs<=startedMs){process.stdout.write('running');return;}
  process.stdout.write(run.success?'ok':'fail:'+(run.errorMessage||'unknown'));
  await p.\$disconnect();
})().catch(e=>{process.stdout.write('err:'+e.message);});
" "$since_iso" 2>/dev/null || echo "err"
    )"
    case "$result" in
      ok)
        return 0
        ;;
      fail:*)
        log "ERROR: feed snapshot rebuild failed: ${result#fail:}"
        return 1
        ;;
      pending|running)
        log "waiting feed snapshot rebuild status=$result elapsed=$((max_wait - (deadline - SECONDS)))s"
        sleep 30
        ;;
      *)
        log "WARN: feed snapshot rebuild poll=$result"
        sleep 30
        ;;
    esac
  done
  log "ERROR: timed out waiting for feed snapshot rebuild after ${max_wait}s (since=$since_iso)"
  return 1
}

wait_image_sync_idle() {
  local deadline=$((SECONDS + IMAGE_SYNC_WAIT_SEC))
  while (( SECONDS < deadline )); do
    local running
    running="$(
      curl -sS --max-time 30 "$BASE_URL/api/galaxus/ops/status" 2>/dev/null \
        | python3 -c 'import json,sys; d=json.load(sys.stdin); print("1" if d.get("feeds",{}).get("imageSyncRunning") else "0")' \
        2>/dev/null || echo 1
    )"
    if [[ "$running" == "0" ]]; then
      return 0
    fi
    log "waiting image-sync idle (elapsed=$((SECONDS - (deadline - IMAGE_SYNC_WAIT_SEC)))s max=${IMAGE_SYNC_WAIT_SEC}s)"
    sleep 30
  done
  log "ERROR: image-sync still running after ${IMAGE_SYNC_WAIT_SEC}s — aborting feeds"
  return 1
}

run_push() {
  local action_name="$1"
  local scope
  scope="$(feed_scope_for_action "$action_name")"
  local max_wait="$WAIT_SEC"
  if [[ "$scope" == "master-specs" ]]; then
    max_wait="$MASTER_WAIT_SEC"
  fi
  local step_started
  step_started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  log "START push step=$action_name scope=$scope max_wait=${max_wait}s"
  step_started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  post_json "{\"action\":\"$action_name\"}" >/dev/null

  if [[ -n "$scope" ]]; then
    if ! wait_scope_success "$scope" "$step_started" "$max_wait"; then
      log "ERROR: push step=$action_name failed verification"
      return 1
    fi
  else
    wait_feed_idle "$max_wait"
  fi
  log "DONE push step=$action_name"
}

run_image_sync_full() {
  log "START image-sync full"
  wait_image_sync_idle || true
  post_json '{"action":"image-sync","imageMode":"full"}' >/dev/null || true
  if [[ "$IMAGE_SYNC_BLOCK_FEEDS" == "1" ]]; then
    if ! wait_image_sync_idle; then
      log "ERROR: image-sync still running after ${IMAGE_SYNC_WAIT_SEC}s — aborting feeds"
      return 1
    fi
  elif ! wait_image_sync_idle; then
    log "WARN: image-sync still running after ${IMAGE_SYNC_WAIT_SEC}s — continuing with stock/price/master feeds"
  fi
  log "DONE image-sync phase"
}

if [[ -z "$ACTION" ]]; then
  log "ERROR: missing action (full-flow | full-push | stx-full | push-master-specs)"
  exit 2
fi

cd /opt/resell

case "$ACTION" in
  full-flow)
    run_image_sync_full || true
    log "START full-flow sequential (rebuild snapshots -> stock -> price -> master-specs)"
    snapshot_started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    if ! post_json '{"action":"rebuild-feed-snapshots"}' >/dev/null; then
      log "WARN: rebuild-feed-snapshots rejected — continuing with existing snapshots"
    elif ! wait_feed_snapshot_rebuild "$snapshot_started"; then
      # Night of 2026-08-04: rebuild finished ~37m but wait was 30m → aborted stock/price/master.
      # Never hard-stop nightly feeds on snapshot wait alone when prior snapshots may still be valid.
      log "WARN: rebuild-feed-snapshots wait failed — continuing full-flow with best-available snapshots"
    fi
    run_push "push-stock"
    run_push "push-price"
    if [[ "$MASTER_NONBLOCKING" == "1" ]]; then
      run_push "push-master-specs" || log "WARN: push-master-specs failed (non-blocking); stock+price already pushed"
    else
      run_push "push-master-specs"
    fi
    log "DONE full-flow"
    ;;
  push-master-specs)
    run_push "push-master-specs"
    log "DONE push-master-specs"
    ;;
  full-push)
    log "START action=full-push"
    step_started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    post_json '{"action":"push-full"}' >/dev/null
    wait_scope_success "full" "$step_started" "$MASTER_WAIT_SEC"
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
