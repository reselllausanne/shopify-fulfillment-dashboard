#!/usr/bin/env bash
#
# Nightly OrderMatch backfill (VPS cron).
#
# Purpose: raise OrderMatch coverage >90% so ROAS / margin dashboards stay
# accurate. Runs scripts/backfill-order-matches.ts in APPLY mode with enrich.
#
# Requires: valid StockXToken row in Postgres (refreshed by stockx-token cron).
#
# Usage:
#   bash scripts/order-match-backfill-cron.sh
#   BACKFILL_DAYS=14 bash scripts/order-match-backfill-cron.sh
#
# Env overrides:
#   BACKFILL_DAYS     default 14 (widen if coverage lags)
#   BACKFILL_LIMIT    default 200 (safety cap per run)
#   BACKFILL_LOG_DIR  default /var/log/resell
#   BACKFILL_APPLY    default 1 (set 0 for dry-run)
#
set -euo pipefail

DAYS="${BACKFILL_DAYS:-14}"
LIMIT="${BACKFILL_LIMIT:-200}"
LOG_DIR="${BACKFILL_LOG_DIR:-/var/log/resell}"
APPLY_FLAG=""
if [[ "${BACKFILL_APPLY:-1}" == "1" ]]; then
  APPLY_FLAG="--apply"
fi

mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/order-match-backfill.log"
LOCK_FILE="/tmp/order-match-backfill.lock"
STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[$STAMP] SKIP already running (lock $LOCK_FILE)" | tee -a "$LOG_FILE"
  exit 0
fi

cd "$(dirname "$0")/.."

echo "[$STAMP] START order-match-backfill days=$DAYS limit=$LIMIT apply=${BACKFILL_APPLY:-1}" | tee -a "$LOG_FILE"

set +e
npx tsx scripts/backfill-order-matches.ts \
  --days="$DAYS" \
  --limit="$LIMIT" \
  --enrich \
  $APPLY_FLAG \
  --json="tmp/backfill-order-matches-latest.json" \
  >>"$LOG_FILE" 2>&1
STATUS=$?
set -e

# Coverage alert: parse the summary and warn if applied is 0 or highMissingCost is high
if command -v jq >/dev/null 2>&1 && [[ -f "tmp/backfill-order-matches-latest.json" ]]; then
  APPLIED=$(jq -r '.applied // 0' tmp/backfill-order-matches-latest.json)
  MISSING=$(jq -r '.highMissingCost // 0' tmp/backfill-order-matches-latest.json)
  UNMATCHED=$(jq -r '.unmatchedCandidates // 0' tmp/backfill-order-matches-latest.json)
  NO_CAND=$(jq -r '.noCandidate // 0' tmp/backfill-order-matches-latest.json)
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] METRICS applied=$APPLIED highMissingCost=$MISSING unmatched=$UNMATCHED noCandidate=$NO_CAND" | tee -a "$LOG_FILE"
  if [[ "$MISSING" -gt 0 ]]; then
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] WARN $MISSING high-confidence matches missing cost — check StockX token" | tee -a "$LOG_FILE"
  fi
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] DONE order-match-backfill exit=$STATUS" | tee -a "$LOG_FILE"
exit "$STATUS"
