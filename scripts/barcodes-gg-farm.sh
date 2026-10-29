#!/usr/bin/env bash
# Farm barcodes.gg until quota thin or priorities drained.
set -euo pipefail
cd "$(dirname "$0")/.."

BATCH="${BATCH:-4000}"
SLEEP_MS="${SLEEP_MS:-500}"
MIN_REMAINING="${MIN_REMAINING:-50}"
LOG="${LOG:-/tmp/barcodes-gg-farm.log}"

remaining_calls() {
  KEY=$(grep '^BARCODES_GG_API_KEY=' .env | cut -d= -f2-)
  curl -sS -H "Authorization: Bearer $KEY" "https://barcodes.gg/api/v2/token/usage" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['usage']['calls']['remaining'])"
}

echo "[farm] start $(date -u +%Y-%m-%dT%H:%M:%SZ) batch=$BATCH" | tee -a "$LOG"

for pri in listed_stock listed in_stock; do
  while true; do
    remaining=$(remaining_calls)
    echo "[farm] priority=$pri remaining=$remaining $(date -u +%H:%M:%SZ)" | tee -a "$LOG"
    if [[ "$remaining" -lt "$MIN_REMAINING" ]]; then
      echo "[farm] stop: remaining < $MIN_REMAINING" | tee -a "$LOG"
      exit 0
    fi
    cap=$BATCH
    if [[ "$remaining" -lt $((BATCH + MIN_REMAINING)) ]]; then
      cap=$((remaining - MIN_REMAINING))
      [[ "$cap" -lt 1 ]] && exit 0
    fi
    echo "[farm] fill --priority=$pri --limit=$cap --apply --shopify" | tee -a "$LOG"
    set +e
    npx tsx scripts/barcodes-gg-fill.ts \
      --fill --priority="$pri" --limit="$cap" --apply --shopify --sleep-ms="$SLEEP_MS" \
      2>&1 | tee -a "$LOG"
    rc=${PIPESTATUS[0]}
    set -e
    skus_n=$(grep -E '^\s*skus:' "$LOG" | tail -1 | grep -oE '[0-9]+' | head -1 || echo 0)
    skus_n=${skus_n:-0}
    echo "[farm] last skus=$skus_n rc=$rc" | tee -a "$LOG"
    if [[ "$skus_n" -lt 10 ]]; then
      echo "[farm] advance priority (drained $pri)" | tee -a "$LOG"
      break
    fi
  done
done
echo "[farm] done $(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$LOG"
