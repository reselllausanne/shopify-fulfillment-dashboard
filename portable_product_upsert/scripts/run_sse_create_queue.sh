#!/usr/bin/env bash
# Daily Shopify create queue from the SSE buffer:
#   1. Sorter: flag unlisted products with recent sales as create candidates
#      (ranked by 15-day sales already stored in rawJson — zero KicksDB calls).
#   2. Consumer in create mode: top-ranked candidates first, capped at 900
#      variant creations (100/day reserved for new variants on existing
#      products created by the regular update path).
set -u
ROOT="/opt/shopify-automation"
LOCK="/tmp/sse_create_queue.lock"
LOG="${ROOT}/logs/sse_create_queue.log"
PYTHON="${ROOT}/venv/bin/python3"
[[ -f "${ROOT}/.env.sse" ]] && set -a && source "${ROOT}/.env.sse" && set +a
API="${RESELL_API_BASE:-http://127.0.0.1:3000}"
AUTH_HEADER=""
[[ -n "${KICKDB_INTERNAL_TOKEN:-}" ]] && AUTH_HEADER="-H x-internal-token:${KICKDB_INTERNAL_TOKEN}"

mkdir -p "${ROOT}/logs"
exec 9>"${LOCK}"
flock -n 9 || exit 0

cd "${ROOT}"
{
  echo "=== $(date -Is) create queue run ==="
  echo "--- sorter (sales) ---"
  # shellcheck disable=SC2086
  curl -s -X POST ${AUTH_HEADER} "${API}/api/kickdb/flag-candidates?minSales=3&limit=100"
  echo
  echo "--- sorter (activity fallback) ---"
  # Drain untracked catalog even when sales_count_15_days is empty on rawJson —
  # rank by KickDBProduct.updatedAt so freshest SSE-touched products create first.
  # shellcheck disable=SC2086
  curl -s -X POST ${AUTH_HEADER} "${API}/api/kickdb/flag-candidates?mode=activity&limit=200"
  echo
  echo "--- creates ---"
  "${PYTHON}" main_from_db.py --db-api "${API}" --status create_candidate \
    --limit 40 --max-create-variants 900
  echo "=== exit=$? ==="
} >> "${LOG}" 2>&1
