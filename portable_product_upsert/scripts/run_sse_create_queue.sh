#!/usr/bin/env bash
# Shopify create queue from the SSE DB buffer.
#
# Safe to cron often (hourly). flock skips overlap. No local create counter —
# main_from_db.py probes Shopify and stops only when Shopify returns the
# daily variant-create limit (cooldown marker then makes later ticks no-op
# until the wait expires).
set -u
ROOT="/opt/shopify-automation"
LOCK="/tmp/sse_create_queue.lock"
LOG="${ROOT}/logs/sse_create_queue.log"
PYTHON="${ROOT}/venv/bin/python3"
[[ -f "${ROOT}/.env.sse" ]] && set -a && source "${ROOT}/.env.sse" && set +a
API="${KICKDB_BUFFER_BASE:-${RESELL_API_BASE:-http://127.0.0.1:3002}}"

mkdir -p "${ROOT}/logs"
exec 9>"${LOCK}"
flock -n 9 || exit 0

cd "${ROOT}"
{
  echo "=== $(date -Is) create queue run ==="
  "${PYTHON}" main_from_db.py --db-api "${API}" --status untracked --limit 500
  echo "=== exit=$? ==="
} >> "${LOG}" 2>&1
