#!/usr/bin/env bash
# Daily Shopify create queue from the SSE buffer.
#
# One-step drain: consumer takes every KickDBProduct with no ShopifySyncState
# row yet (freshest SSE refresh first) and creates it on Shopify, capped at
# 900 variant creations/day (100/day reserved for new variants on existing
# products via the update path).
#
# ShopifySyncState is created only on successful push (see mark_synced in
# main_from_db.py), so repeated runs never double-push the same product and
# create_candidate flag hygiene is not required.
set -u
ROOT="/opt/shopify-automation"
LOCK="/tmp/sse_create_queue.lock"
LOG="${ROOT}/logs/sse_create_queue.log"
PYTHON="${ROOT}/venv/bin/python3"
[[ -f "${ROOT}/.env.sse" ]] && set -a && source "${ROOT}/.env.sse" && set +a
API="${RESELL_API_BASE:-http://127.0.0.1:3000}"

mkdir -p "${ROOT}/logs"
exec 9>"${LOCK}"
flock -n 9 || exit 0

cd "${ROOT}"
{
  echo "=== $(date -Is) create queue run ==="
  "${PYTHON}" main_from_db.py --db-api "${API}" --status untracked \
    --limit 40 --max-create-variants 900
  echo "=== exit=$? ==="
} >> "${LOG}" 2>&1
