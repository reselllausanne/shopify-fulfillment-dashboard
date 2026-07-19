#!/usr/bin/env bash
# Refresh stale catalog products (availability decay protection). Cron: daily.
# 20k catalog / 7-day max age needs ~3k refreshes per day.
set -u
ROOT="/opt/shopify-automation"
LOCK="/tmp/sse_sweeper.lock"
LOG="${ROOT}/logs/sse_sweeper.log"
PYTHON="${ROOT}/venv/bin/python3"
[[ -f "${ROOT}/.env.sse" ]] && set -a && source "${ROOT}/.env.sse" && set +a

mkdir -p "${ROOT}/logs"
exec 9>"${LOCK}"
flock -n 9 || exit 0

cd "${ROOT}"
{
  echo "=== $(date -Is) sweeper run ==="
  "${PYTHON}" sweeper_refresh_stale.py --db-api "${RESELL_API_BASE:-http://127.0.0.1:3000}" \
    --max-age-days 7 --limit 3000
  echo "=== exit=$? ==="
} >> "${LOG}" 2>&1
