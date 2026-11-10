#!/usr/bin/env bash
# Safe Docker garbage collection for the VPS (called at the end of a deploy, lock held).
#
# Why: every deploy builds a new app image (COPY . . + next build ≈ 2 GB of unique layers) and
# BuildKit keeps every intermediate. With many merges per day the disk filled (178 GB images,
# 183 GB build cache, 164 GB / 167 GB reclaimable, disk 83 %).
#
# Guarantees (static-checked in vps-deploy-from-github.test.sh):
# - NEVER touches volumes (no `volume prune`, no `system prune`, no `--volumes`).
# - Only removes images not used by ANY container (running or stopped) AND older than the
#   cutoff; running services keep their image. Build cache is trimmed to a size budget (LRU).
# - Recent images (default 72h) stay for fast rollback; older ones rebuild from the exact SHA.
# - Non-fatal: a failing prune never fails a deploy (caller uses `|| echo WARN`).
#
# Usage: bash scripts/vps-docker-gc.sh [--dry-run]
#   DOCKER_GC_UNTIL_HOURS=72   image cutoff age in hours (min 24 enforced)
#   DOCKER_GC_KEEP_CACHE_GB=30 build cache is BOUNDED by size (LRU keeps the newest); age alone is
#                              not enough: ~7 deploys/day refill 72 h of cache (170 GB observed)
set -euo pipefail

UNTIL_HOURS="${DOCKER_GC_UNTIL_HOURS:-72}"
KEEP_CACHE_GB="${DOCKER_GC_KEEP_CACHE_GB:-30}"
if ! [[ "$KEEP_CACHE_GB" =~ ^[0-9]+$ ]] || [ "$KEEP_CACHE_GB" -lt 10 ]; then
  echo "[docker-gc] DOCKER_GC_KEEP_CACHE_GB must be an integer >= 10 (got '$KEEP_CACHE_GB')" >&2
  exit 2
fi
if ! [[ "$UNTIL_HOURS" =~ ^[0-9]+$ ]] || [ "$UNTIL_HOURS" -lt 24 ]; then
  echo "[docker-gc] DOCKER_GC_UNTIL_HOURS must be an integer >= 24 (got '$UNTIL_HOURS')" >&2
  exit 2
fi

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

if ! command -v docker >/dev/null 2>&1; then
  echo "[docker-gc] docker not found — skip"
  exit 0
fi

echo "[docker-gc] before:"
docker system df || true

if [ "$DRY_RUN" = "1" ]; then
  echo "[docker-gc] (dry-run) would run:"
  echo "  docker image prune -a -f --filter until=${UNTIL_HOURS}h"
  echo "  docker builder prune -f --keep-storage ${KEEP_CACHE_GB}GB"
  exit 0
fi

docker image prune -a -f --filter "until=${UNTIL_HOURS}h" || echo "[docker-gc] WARN: image prune failed"
docker builder prune -f --keep-storage "${KEEP_CACHE_GB}GB" || echo "[docker-gc] WARN: builder prune failed"

echo "[docker-gc] after:"
docker system df || true
