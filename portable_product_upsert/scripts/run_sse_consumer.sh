#!/usr/bin/env bash
# SSE DB buffer -> Shopify updates. Cron: every 15 min.
# Skips silently if a previous run is still going (flock) or if main.py's
# 429 cooldown marker is active (main.py handles that itself via partials).
set -u
ROOT="/opt/shopify-automation"
LOCK="/tmp/sse_consumer.lock"
LOG="${ROOT}/logs/sse_consumer.log"
PYTHON="${ROOT}/venv/bin/python3"
# Shared secret + API base for the kickdb buffer routes (not in git).
[[ -f "${ROOT}/.env.sse" ]] && set -a && source "${ROOT}/.env.sse" && set +a

mkdir -p "${ROOT}/logs"
exec 9>"${LOCK}"
flock -n 9 || exit 0

cd "${ROOT}"
{
  echo "=== $(date -Is) sse consumer run ==="
  "${PYTHON}" main_from_db.py --db-api "${RESELL_API_BASE:-http://127.0.0.1:3000}" --limit 100
  echo "=== exit=$? ==="
} >> "${LOG}" 2>&1
