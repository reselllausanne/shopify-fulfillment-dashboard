#!/usr/bin/env bash
# Shopify liquidation convergence (physical qty → price/stock state).
set -euo pipefail
cd /opt/resell
TOKEN=$(grep '^KICKDB_INTERNAL_TOKEN=' .env | cut -d'"' -f2)
LOG=/opt/resell/logs/convergence.log
mkdir -p /opt/resell/logs
{
  echo "[$(date -Iseconds)] convergence-cron start"
  curl -sS --max-time 540 -X POST \
    -H "x-internal-token: $TOKEN" \
    -H 'content-type: application/json' \
    'http://127.0.0.1:3000/api/inventory/convergence/run'
  echo
  echo "[$(date -Iseconds)] convergence-cron end"
} >> "$LOG" 2>&1
