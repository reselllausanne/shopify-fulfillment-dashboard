#!/usr/bin/env bash
#
# Galaxus scheduled ops (VPS cron).
#
# Usage:
#   bash scripts/galaxus-ops-cron.sh stock-price-flow   # nightly: stock/offer snap → stock + price
#   bash scripts/galaxus-ops-cron.sh push-master-specs  # nightly: master/specs snap → COPY → SFTP
#   bash scripts/galaxus-ops-cron.sh stx-full           # full StockX/KickDB catalog sync
#
# Durable nightly (VPS crontab): stock-price-flow @02:00 UTC, push-master-specs @04:00 UTC.
# Locks are PER ACTION — stock must never block master (shared flock caused 04:00 SKIP).
# Master = Postgres COPY + oneshot SFTP only. Never feed-worker Prisma stream.
#
# Env overrides:
#   GALAXUS_OPS_BASE_URL   default http://127.0.0.1:3000
#   GALAXUS_OPS_LOG_DIR    default /var/log/resell
#   GALAXUS_OPS_WAIT_SEC            default 3600 (stock/price max wait)
#   GALAXUS_OPS_IMAGE_SYNC_WAIT_SEC default 5400
#   GALAXUS_OPS_IMAGE_SYNC_BLOCK_FEEDS default 0
#   GALAXUS_OPS_SNAPSHOT_WAIT_SEC     default 4500
#   GALAXUS_MASTER_SPECS_SKIP_REBUILD_IF_FRESH_HOURS default 36
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
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/galaxus-ops-cron.log"

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG_FILE"
}

if [[ -z "$ACTION" ]]; then
  log "ERROR: missing action (stock-price-flow | push-master-specs | stx-full)"
  exit 2
fi

# Per-action flock — stock-price-flow and push-master-specs may overlap.
LOCK_FILE="/tmp/galaxus-ops-${ACTION}.lock"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "SKIP already running (lock $LOCK_FILE)"
  exit 0
fi

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
  log "START image-sync full (tsx, off web HTTP)"
  docker compose exec -T web npx tsx scripts/run-image-sync-full.ts || {
    log "WARN: image-sync tsx failed — continuing if non-blocking"
    return 0
  }
  log "DONE image-sync phase"
}

run_snapshot_rebuild() {
  log "START rebuild-feed-snapshots (tsx, off web HTTP)"
  snapshot_started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  # Survive deploys: plain docker run labelled resell-oneshot (compose run on
  # project=resell gets SIGKILL when worker-ops-background is rebuilt).
  if ! bash scripts/vps-ops-oneshot-run.sh feed-snap-rebuild \
    npx tsx scripts/run-feed-snapshot-rebuild.ts; then
    log "WARN: rebuild-feed-snapshots tsx failed — continuing with best-available snapshots"
    return 0
  fi
  log "DONE rebuild-feed-snapshots"
}

run_master_specs_snapshot_rebuild() {
  log "START rebuild-master-specs-snapshot (tsx, ops-background heap, Phase-2 memory-flat)"
  if ! bash scripts/vps-ops-oneshot-run.sh master-specs-snap-rebuild \
    npx tsx scripts/run-master-specs-snapshot-rebuild.ts; then
    log "ERROR: rebuild-master-specs-snapshot failed — refusing live fallback (OOM)"
    return 1
  fi
  log "DONE rebuild-master-specs-snapshot"
}

# Postgres COPY → CSV → SFTP. Feed-worker Prisma stream hangs/OOM on ~7M specs rows.
# Dump dir under .data so oneshot SFTP sees it via the standard /app/.data mount
# (plain `compose run` is SIGKILL'd by deploys — same bug as snap rebuild).
run_master_specs_copy_push() {
  local dump_dir="${GALAXUS_MASTER_SPECS_DUMP_DIR:-/opt/resell/.data/galaxus-master-specs-snap}"
  local container_dir="/app/.data/galaxus-master-specs-snap"
  log "START master-specs COPY dump + SFTP (dir=$dump_dir)"
  rm -rf "$dump_dir"
  mkdir -p "$dump_dir"
  if ! bash scripts/dump-galaxus-master-specs-snapshot-csv.sh "$dump_dir"; then
    log "ERROR: master-specs COPY dump failed"
    return 1
  fi
  if ! bash scripts/vps-ops-oneshot-run.sh master-specs-copy-sftp \
    env GALAXUS_MASTER_SPECS_PREBUILT_DIR="$container_dir" \
    npx tsx scripts/sftp-galaxus-master-specs-csv.ts; then
    log "ERROR: master-specs SFTP of COPY CSVs failed"
    return 1
  fi
  log "DONE master-specs COPY dump + SFTP"
}

# Skip snap rebuild when meta is fresh (default 36h). Nightly still rebuilds when stale.
master_specs_snapshot_is_fresh() {
  local max_hours="${GALAXUS_MASTER_SPECS_SKIP_REBUILD_IF_FRESH_HOURS:-36}"
  docker compose exec -T web node -e "
const {PrismaClient}=require('@prisma/client');
const p=new PrismaClient();
const maxH=Number(process.env.MAX_H||${max_hours});
(async()=>{
  const m=await p.galaxusFeedSnapshotMeta.findUnique({where:{id:'default'},select:{masterRebuiltAt:true,specsRebuiltAt:true,masterRowCount:true,specsRowCount:true}});
  await p.\$disconnect();
  if(!m?.masterRebuiltAt||!m?.specsRebuiltAt||!(m.masterRowCount>0)||!(m.specsRowCount>0)){process.exit(1)}
  const age=Math.max(Date.now()-new Date(m.masterRebuiltAt).getTime(), Date.now()-new Date(m.specsRebuiltAt).getTime());
  process.exit(age <= maxH*3600*1000 ? 0 : 1);
})().catch(()=>process.exit(1));
" 2>/dev/null
}

cd /opt/resell

case "$ACTION" in
  stock-price-flow)
    log "START stock-price-flow (rebuild snapshots -> stock + price)"
    run_snapshot_rebuild || true
    step_started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    post_json '{"action":"push-stock"}' >/dev/null || log "WARN: enqueue push-stock failed"
    post_json '{"action":"push-price"}' >/dev/null || log "WARN: enqueue push-price failed"
    wait_scope_success "stock" "$step_started" "$WAIT_SEC" \
      || log "WARN: stock failed/timed out"
    wait_scope_success "price" "$step_started" "$WAIT_SEC" \
      || log "WARN: price failed/timed out"
    log "DONE stock-price-flow"
    ;;
  push-master-specs)
    # Nightly durable: rebuild snap (if stale) → Postgres COPY CSVs → SFTP oneshot.
    # Never use feed-worker Prisma stream for 7M specs (hangs / heap blowup).
    if master_specs_snapshot_is_fresh; then
      log "SKIP master/specs snapshot rebuild — meta fresh (<${GALAXUS_MASTER_SPECS_SKIP_REBUILD_IF_FRESH_HOURS:-36}h)"
    elif ! run_master_specs_snapshot_rebuild; then
      log "ERROR: push-master-specs aborted — snapshot rebuild failed (no live fallback)"
      exit 1
    fi
    if ! run_master_specs_copy_push; then
      log "ERROR: push-master-specs aborted — COPY/SFTP failed"
      exit 1
    fi
    log "DONE push-master-specs"
    ;;
  full-flow|full-push)
    log "ERROR: '$ACTION' removed — run stock-price-flow and push-master-specs separately (split locks)"
    exit 2
    ;;
  stx-full)
    log "START action=stx-full"
    post_json '{"action":"stx-refresh","stxMode":"full"}' >/dev/null
    log "DONE action=stx-full (async job accepted)"
    ;;
  *)
    log "ERROR: unknown action '$ACTION' (stock-price-flow | push-master-specs | stx-full)"
    exit 2
    ;;
esac

exit 0
