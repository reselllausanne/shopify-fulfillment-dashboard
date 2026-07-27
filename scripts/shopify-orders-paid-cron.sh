#!/usr/bin/env bash
# Backup for orders/paid webhook — converge Bussigny / locked STX after Shopify web sales.
set -euo pipefail
cd /opt/resell
TOKEN=$(grep '^KICKDB_INTERNAL_TOKEN=' .env | cut -d'"' -f2)
LOG=/opt/resell/logs/shopify-orders-paid-cron.log
mkdir -p /opt/resell/logs
{
  echo "[$(date -Iseconds)] shopify-orders-paid-cron start"
  # Normal runs are seconds (processed lines are skipped via ShopifyPaidLineState);
  # only a backlog needs minutes, and cutting it mid-work loses the response, not the work.
  curl -sS --max-time 600 -X POST \
    -H "x-internal-token: $TOKEN" \
    -H 'content-type: application/json' \
    -d '{"mode":"recent-paid","sinceMinutes":20}' \
    'http://127.0.0.1:3000/api/inventory/convergence/run'
  echo
  echo "[$(date -Iseconds)] shopify-orders-paid-cron end"
} >> "$LOG" 2>&1
