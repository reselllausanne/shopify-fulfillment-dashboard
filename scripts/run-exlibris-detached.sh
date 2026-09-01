#!/usr/bin/env bash
# Run full Ex Libris listing crawl in a one-off container (survives `web` restarts).
# Output + checkpoint: .data/exlibris/ on the host.
#
# Usage:
#   /opt/resell/scripts/run-exlibris-detached.sh
#   EXLIBRIS_CATALOG=musik_cd EXLIBRIS_LIMIT=5000 /opt/resell/scripts/run-exlibris-detached.sh
set -euo pipefail
REPO_DIR="${REPO_DIR:-/opt/resell}"
cd "$REPO_DIR"
mkdir -p logs .data/exlibris
LOG="${REPO_DIR}/logs/exl-full-$(date -u +%Y%m%dT%H%M%SZ).log"

docker rm -f resell-exl-scrape 2>/dev/null || true

echo "[$(date -Is)] starting detached exl scrape -> $LOG" | tee -a "$LOG"
# nohup + compose run (not exec into web) so web recreate cannot kill the job
nohup docker compose run --name resell-exl-scrape --rm \
  -e EXLIBRIS_CATALOG="${EXLIBRIS_CATALOG:-spiele}" \
  -e EXLIBRIS_LIMIT="${EXLIBRIS_LIMIT:-0}" \
  -e EXLIBRIS_DELAY="${EXLIBRIS_DELAY:-1.0}" \
  -e EXLIBRIS_FLUSH_EVERY="${EXLIBRIS_FLUSH_EVERY:-100}" \
  -v "${REPO_DIR}/.data/exlibris:/app/supplier-viability-poc/data" \
  web bash supplier-viability-poc/scripts/run_exlibris_day.sh \
  >>"$LOG" 2>&1 &
echo "[$(date -Is)] pid=$! log=$LOG"
echo "follow: tail -f $LOG"
echo "checkpoint: ${REPO_DIR}/.data/exlibris/exlibris_checkpoint.json"
