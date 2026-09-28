#!/usr/bin/env bash
# SSE DB buffer -> Shopify price/qty updates.
# Cron every 2 min: flock + continuous loop drains backlog without
# waiting 15m between batches (storefront was selling under STX cost).
set -u
ROOT="/opt/shopify-automation"
LOCK="/tmp/sse_consumer.lock"
LOG="${ROOT}/logs/sse_consumer.log"
PYTHON="${ROOT}/venv/bin/python3"
if [[ ! -x "${PYTHON}" ]]; then PYTHON="$(command -v python3)"; fi
# Shared secret + API base for the kickdb buffer routes (not in git).
[[ -f "${ROOT}/.env.sse" ]] && set -a && source "${ROOT}/.env.sse" && set +a

mkdir -p "${ROOT}/logs"
exec 9>"${LOCK}"
flock -n 9 || exit 0

cd "${ROOT}"
DB_API="${KICKDB_BUFFER_BASE:-${RESELL_API_BASE:-http://127.0.0.1:3002}}"
LIMIT="${SSE_CONSUMER_LIMIT:-500}"
# Keep chewing while queue has work. Empty batch → exit (cron restarts soon).
MAX_BATCHES="${SSE_CONSUMER_MAX_BATCHES:-40}"
IDLE_SLEEP_SEC="${SSE_CONSUMER_IDLE_SLEEP_SEC:-2}"

{
  echo "=== $(date -Is) sse consumer run ==="
  batch=0
  while (( batch < MAX_BATCHES )); do
    batch=$((batch + 1))
    echo "--- batch ${batch}/${MAX_BATCHES} limit=${LIMIT} ---"
    # Hard cap per batch: a stuck Shopify socket must never hold the flock forever.
    timeout --kill-after=60 "${SSE_CONSUMER_BATCH_TIMEOUT_SEC:-3600}" \
      "${PYTHON}" main_from_db.py --db-api "${DB_API}" --limit "${LIMIT}"
    rc=$?
    echo "=== batch_exit=${rc} ==="
    if [[ "${rc}" -ne 0 ]]; then
      echo "=== exit=${rc} (stop loop) ==="
      exit "${rc}"
    fi
    remaining="$("${PYTHON}" - <<PY
import os, requests
base = os.environ.get("KICKDB_BUFFER_BASE") or os.environ.get("RESELL_API_BASE") or "${DB_API}"
tok = (os.environ.get("KICKDB_INTERNAL_TOKEN") or "").strip()
h = {"x-internal-token": tok} if tok else {}
try:
    r = requests.get(f"{base}/api/kickdb/fresh", params={"limit": 1, "status": "pending"}, headers=h, timeout=20)
    body = r.json() if r.ok else {}
    print(int(body.get("count") or 0))
except Exception:
    print(-1)
PY
)"
    echo "[INFO] fresh_remaining_sample=${remaining}"
    if [[ "${remaining}" == "0" ]]; then
      echo "=== exit=0 (queue empty) ==="
      exit 0
    fi
    sleep "${IDLE_SLEEP_SEC}"
  done
  echo "=== exit=0 (max batches) ==="
} >> "${LOG}" 2>&1
