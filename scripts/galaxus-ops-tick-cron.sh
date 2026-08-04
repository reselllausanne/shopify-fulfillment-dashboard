#!/usr/bin/env bash
#
# Hourly Galaxus ops tick (VPS cron).
# Runs due background jobs from GalaxusJobDefinition, including:
#   - gld-refresh (every 10h) — Golden price/stock
#   - stx-refresh, partner-stock-sync, edi-in, etc. when due
#
# Usage:
#   bash scripts/galaxus-ops-tick-cron.sh
#
# Env:
#   GALAXUS_OPS_BASE_URL  default http://127.0.0.1:3000
#   GALAXUS_OPS_LOG_DIR   default /var/log/resell
#
set -euo pipefail

BASE_URL="${GALAXUS_OPS_BASE_URL:-http://127.0.0.1:3000}"
LOG_DIR="${GALAXUS_OPS_LOG_DIR:-/var/log/resell}"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/galaxus-ops-tick-cron.log"

resp="$(
  curl -sS --max-time 600 \
    -X GET "$BASE_URL/api/galaxus/ops/tick" \
    2>&1 || echo '{"ok":false,"error":"curl failed"}'
)"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $resp" >> "$LOG_FILE"
