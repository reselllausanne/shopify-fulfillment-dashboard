#!/usr/bin/env bash
# Shopify → DB location-stock mirror.
# Shopify Admin / POS is master for physical qty. This cron pulls it into
# ShopifyVariantLocationStock so marketplace feeds + convergence see reality.
set -euo pipefail
cd /opt/resell
LOG=/opt/resell/logs/location-mirror.log
LOCK_FILE="/tmp/location-mirror-cron.lock"
mkdir -p /opt/resell/logs

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[$(date -Iseconds)] location-mirror-cron SKIP already running (lock $LOCK_FILE)" >> "$LOG"
  exit 0
fi

{
  echo "[$(date -Iseconds)] location-mirror-cron start"
  docker compose exec -T web npx tsx scripts/run-location-mirror.ts
  echo "[$(date -Iseconds)] location-mirror-cron end"
} >> "$LOG" 2>&1
