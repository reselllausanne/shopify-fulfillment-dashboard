#!/usr/bin/env bash
#
# Drain the Galaxus feed push queue (every 10 min on VPS cron).
#
# Post-sale price pushes enqueue a trigger when a feed run is already active. Without
# this drain the queue only moved when another push finished or at the 02:00 full-flow,
# so a sale could sit hours behind a stale PriceData file. Also reaps zombie runs
# (container restart mid-push leaves finishedAt=null and blocks every later push).
set -euo pipefail

BASE_URL="${GALAXUS_OPS_BASE_URL:-http://127.0.0.1:3000}"
STALE_MINUTES="${GALAXUS_FEED_STALE_MINUTES:-45}"
LOG_DIR="${GALAXUS_OPS_LOG_DIR:-/var/log/resell}"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/marketplace-price-queue-cron.log"

resp="$(
  curl -sS --max-time 90 \
    -X POST "$BASE_URL/api/galaxus/ops/run" \
    -H 'content-type: application/json' \
    -d "{\"action\":\"drain-queue\",\"staleMinutes\":$STALE_MINUTES}" 2>&1 || echo '{"ok":false,"error":"curl failed"}'
)"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $resp" >> "$LOG_FILE"
