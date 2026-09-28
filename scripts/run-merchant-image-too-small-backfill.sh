#!/usr/bin/env bash
# Targeted repair from Merchant/Ads image_too_small product id list.
set -euo pipefail
cd "$(dirname "$0")/.."

LIMIT="${LIMIT:-5000}"
CONCURRENCY="${CONCURRENCY:-8}"
MAX_ROUNDS="${MAX_ROUNDS:-80}"
SLEEP_BETWEEN_S="${SLEEP_BETWEEN_S:-15}"
OFFSET="${OFFSET:-0}"
IDS_FILE="${IDS_FILE:-tmp/merchant-image-too-small-product-ids.json}"
empty_rounds=0

for round in $(seq 1 "$MAX_ROUNDS"); do
  echo "{\"event\":\"loop_start\",\"round\":$round,\"limit\":$LIMIT,\"concurrency\":$CONCURRENCY,\"offset\":$OFFSET,\"idsFile\":\"$IDS_FILE\"}"
  set +e
  npx tsx scripts/backfill-kicksdb-shopify-images.ts \
    --limit="$LIMIT" \
    --concurrency="$CONCURRENCY" \
    --offset="$OFFSET" \
    --product-ids-file="$IDS_FILE" \
    --apply \
    --confirm=REPLACE_KICKDB_HERO \
    --wait
  code=$?
  set -e

  repaired=$(python3 -c '
import json
try:
  r=json.load(open("tmp/kicksdb-image-backfill-report.json"))
  print(int(r.get("repairedVerified") or 0))
except Exception:
  print(0)
')
  aborted=$(python3 -c '
import json
try:
  r=json.load(open("tmp/kicksdb-image-backfill-report.json"))
  print("1" if r.get("abortedForFetchStorm") else "0")
except Exception:
  print("0")
')
  scanned=$(python3 -c '
import json
try:
  r=json.load(open("tmp/kicksdb-image-backfill-report.json"))
  print(int(r.get("scanned") or 0))
except Exception:
  print(0)
')

  echo "{\"event\":\"loop_end\",\"round\":$round,\"exit\":$code,\"repairedVerified\":$repaired,\"aborted\":$aborted,\"offset\":$OFFSET,\"scanned\":$scanned}"

  if [[ "$aborted" == "1" || "$code" == "2" ]]; then
    sleep "$SLEEP_BETWEEN_S"
    empty_rounds=0
    continue
  fi

  # Advance through the id list each round (completed ids are skipped via progress).
  OFFSET=$((OFFSET + LIMIT))
  if [[ "$repaired" -eq 0 && "$code" -eq 0 ]]; then
    empty_rounds=$((empty_rounds + 1))
    if [[ "$empty_rounds" -ge 3 || "$scanned" -eq 0 ]]; then
      echo "{\"event\":\"loop_done\",\"reason\":\"caught_up\",\"empty_rounds\":$empty_rounds}"
      exit 0
    fi
  else
    empty_rounds=0
  fi
  sleep "$SLEEP_BETWEEN_S"
done

echo "{\"event\":\"loop_done\",\"reason\":\"max_rounds\"}"
exit 0
