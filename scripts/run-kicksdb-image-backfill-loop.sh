#!/usr/bin/env bash
# Keeps the hero-image backfill alive across transient Shopify/DB drops.
# Walks the catalog oldest→newest with --offset bumps when a window is empty.
set -euo pipefail
cd "$(dirname "$0")/.."

LIMIT="${LIMIT:-5000}"
CONCURRENCY="${CONCURRENCY:-8}"
MAX_ROUNDS="${MAX_ROUNDS:-80}"
SLEEP_BETWEEN_S="${SLEEP_BETWEEN_S:-20}"
WINDOW="${WINDOW:-15000}"
OFFSET="${OFFSET:-15000}"
empty_rounds=0

for round in $(seq 1 "$MAX_ROUNDS"); do
  echo "{\"event\":\"loop_start\",\"round\":$round,\"limit\":$LIMIT,\"concurrency\":$CONCURRENCY,\"offset\":$OFFSET}"
  set +e
  npx tsx scripts/backfill-kicksdb-shopify-images.ts \
    --limit="$LIMIT" \
    --concurrency="$CONCURRENCY" \
    --offset="$OFFSET" \
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
    echo "{\"event\":\"loop_backoff\",\"reason\":\"fetch_storm\",\"sleep\":$SLEEP_BETWEEN_S}"
    sleep "$SLEEP_BETWEEN_S"
    empty_rounds=0
    continue
  fi

  if [[ "$repaired" -eq 0 && "$code" -eq 0 ]]; then
    empty_rounds=$((empty_rounds + 1))
    OFFSET=$((OFFSET + WINDOW))
    echo "{\"event\":\"loop_advance_offset\",\"offset\":$OFFSET,\"empty_rounds\":$empty_rounds}"
    if [[ "$empty_rounds" -ge 8 ]]; then
      echo "{\"event\":\"loop_done\",\"reason\":\"eight_empty_windows\"}"
      exit 0
    fi
    if [[ "$scanned" -eq 0 ]]; then
      echo "{\"event\":\"loop_done\",\"reason\":\"past_end_of_catalog\"}"
      exit 0
    fi
  else
    empty_rounds=0
    # Keep offset; still meat in this window until a full empty pass.
  fi

  sleep "$SLEEP_BETWEEN_S"
done

echo "{\"event\":\"loop_done\",\"reason\":\"max_rounds\"}"
exit 0
