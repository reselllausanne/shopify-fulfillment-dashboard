#!/usr/bin/env bash
#
# Daily Google Ads spend → DailyAdSpend (margin dashboard).
# VPS cron example (Europe/Zurich ~07:30):
#   30 7 * * * /opt/resell/scripts/ads-spend-cron.sh
#
# Env overrides:
#   ADS_SPEND_DAYS     lookback days (default 14 — conversion lag window)
#   ADS_SPEND_LOG_DIR  log directory (default /var/log/resell)
#
set -euo pipefail

DAYS="${ADS_SPEND_DAYS:-14}"
LOG_DIR="${ADS_SPEND_LOG_DIR:-/var/log/resell}"
LOCK_FILE="/tmp/ads-spend-cron.lock"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/ads-spend-cron.log"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] SKIP already running (lock $LOCK_FILE)" | tee -a "$LOG_FILE"
  exit 0
fi

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG_FILE"
}

cd /opt/resell

log "START ads backfill --days=${DAYS}"
if docker compose -f /opt/resell/docker-compose.yml exec -T web npm run ads -- backfill --days="$DAYS"; then
  log "DONE ads backfill --days=${DAYS}"
  exit 0
fi

log "ERROR: ads backfill failed"
exit 1
