#!/usr/bin/env bash
# Shopify → DB location-stock mirror.
# Shopify Admin / POS is master for physical qty. This cron pulls it into
# ShopifyVariantLocationStock so marketplace feeds + convergence see reality.
set -euo pipefail
cd /opt/resell
TOKEN=$(grep '^KICKDB_INTERNAL_TOKEN=' .env | cut -d'"' -f2)
LOG=/opt/resell/logs/location-mirror.log
mkdir -p /opt/resell/logs
{
  echo "[$(date -Iseconds)] location-mirror-cron start"
  curl -sS --max-time 540 -X POST \
    -H "x-internal-token: $TOKEN" \
    -H 'content-type: application/json' \
    'http://127.0.0.1:3000/api/inventory/locations/sync?method=bulk'
  echo
  echo "[$(date -Iseconds)] location-mirror-cron end"
} >> "$LOG" 2>&1
