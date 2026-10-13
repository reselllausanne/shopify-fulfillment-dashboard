#!/usr/bin/env bash
# Refresh stale catalog products (availability decay protection). Cron: daily.
# ~99k catalog: 14k/day ≈ 7-day cycle. stx-refresh zeroes live sold-outs on
# Shopify every run, so the sweeper is the long-tail backstop, not the only one.
set -u
ROOT="/opt/shopify-automation"
LOCK="/tmp/sse_sweeper.lock"
LOG="${ROOT}/logs/sse_sweeper.log"
PYTHON="${ROOT}/venv/bin/python3"
if [[ ! -x "${PYTHON}" ]]; then PYTHON="$(command -v python3)"; fi
[[ -f "${ROOT}/.env.sse" ]] && set -a && source "${ROOT}/.env.sse" && set +a

mkdir -p "${ROOT}/logs"
exec 9>"${LOCK}"
flock -n 9 || exit 0

cd "${ROOT}"
{
  echo "=== $(date -Is) sweeper run ==="
  "${PYTHON}" sweeper_refresh_stale.py --db-api "${KICKDB_BUFFER_BASE:-${RESELL_API_BASE:-http://127.0.0.1:3002}}" \
    --max-age-days 3 --limit "${SWEEPER_LIMIT:-14000}"
  echo "=== exit=$? ==="
} >> "${LOG}" 2>&1
