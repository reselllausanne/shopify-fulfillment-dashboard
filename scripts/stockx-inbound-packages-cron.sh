#!/usr/bin/env bash
# Cron entry to refresh Shopify AWB fallback inventory from the StockX buying API.
# Usage: */10 * * * * /opt/resell/scripts/stockx-inbound-packages-cron.sh
#
# Env (all optional):
#   STOCKX_INBOUND_SYNC_URL   default: http://localhost:3000/api/stockx/inbound-packages/sync
#   INTERNAL_API_KEY          forwarded as `x-internal-key` when set
#   STOCKX_INBOUND_LIMIT      default: 100 (rows kept per StockX account)
#   STOCKX_INBOUND_MAX_PAGES  default: 4
#   STOCKX_INBOUND_CONCURRENCY default: 2

set -euo pipefail

URL="${STOCKX_INBOUND_SYNC_URL:-http://localhost:3000/api/stockx/inbound-packages/sync}"
LIMIT="${STOCKX_INBOUND_LIMIT:-100}"
MAX_PAGES="${STOCKX_INBOUND_MAX_PAGES:-4}"
CONCURRENCY="${STOCKX_INBOUND_CONCURRENCY:-2}"

BODY=$(printf '{"limit":%s,"maxPages":%s,"concurrency":%s}' \
  "${LIMIT}" "${MAX_PAGES}" "${CONCURRENCY}")

HEADERS=(-H "content-type: application/json")
if [[ -n "${INTERNAL_API_KEY:-}" ]]; then
  HEADERS+=(-H "x-internal-key: ${INTERNAL_API_KEY}")
fi

curl --fail --show-error --silent --max-time 300 \
  -X POST "${URL}" \
  "${HEADERS[@]}" \
  -d "${BODY}"
echo
