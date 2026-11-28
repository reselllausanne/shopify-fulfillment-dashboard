#!/usr/bin/env bash
# Full, reproducible scale recipe on an ISOLATED local PostgreSQL cluster (never production):
#   fresh database → warehouse migration → 10 000 → 100 000 → 200 000 pairs (+1 M movements)
#   → 1 000 000 cumulated label codes → restore drill.
# The same database grows from tier to tier: no pair is re-issued or re-imported.
# Results: docs/warehouse/recette/*.json
#
#   scripts/warehouse/run-recette.sh            # everything (≈ 25 min on a laptop, incl. 10 min of sustained load)
#   WAREHOUSE_RECETTE_SUSTAINED_SECONDS=0 scripts/warehouse/run-recette.sh   # skip the sustained step
#   scripts/warehouse/run-recette.sh 10k        # first tier only
set -euo pipefail
cd "$(dirname "$0")/../.."

export WAREHOUSE_PG_DATA="${WAREHOUSE_PG_DATA:-$HOME/.cache/resell-warehouse-pg/data-scale}"
export WAREHOUSE_PG_PORT="${WAREHOUSE_PG_PORT:-54330}"
export WAREHOUSE_PG_DB="${WAREHOUSE_PG_DB:-warehouse_scale}"
export WAREHOUSE_TEST_DATABASE_URL="postgresql://warehouse:warehouse@127.0.0.1:${WAREHOUSE_PG_PORT}/${WAREHOUSE_PG_DB}?schema=public"
OUT="${WAREHOUSE_RECETTE_OUT:-docs/warehouse/recette}"
ONLY="${1:-all}"
mkdir -p "$OUT"

# Cold start: restart the cluster so PostgreSQL's buffer cache is empty (the OS file cache is not purged).
restart() { scripts/warehouse/dev-db.sh stop >/dev/null; scripts/warehouse/dev-db.sh start >/dev/null; }
seed() { npx tsx scripts/warehouse/scale-seed.ts "${@:2}" | sed -n '/^{/,$p' > "$OUT/seed-$1.json"; }
bench() { restart; npx tsx scripts/warehouse/scale-bench.ts --label "$1" --seconds "$2" --out "$OUT/bench-$1.json" > /dev/null; }

scripts/warehouse/dev-db.sh start >/dev/null
scripts/warehouse/dev-db.sh reset >/dev/null
node scripts/warehouse/setup-test-db.mjs --url "$WAREHOUSE_TEST_DATABASE_URL" >/dev/null

echo "== 10 000 pairs, 2 sites";            seed 10k --active 10000;                      bench 10k 30
[[ "$ONLY" == "10k" ]] && { echo "== done (10k only)"; exit 0; }
echo "== 100 000 pairs, 3 sites";           seed 100k --active 100000;                    bench 100k 30
echo "== 200 000 pairs + 1 M movements";    seed 200k --active 200000 --movements 1000000; bench 200k 60
echo "== 1 000 000 cumulated label codes";  seed 1M-codes --active 200000 --codes 1000000; bench 1M-codes 30
if [[ "${WAREHOUSE_RECETTE_SUSTAINED_SECONDS:-600}" != "0" ]]; then
  echo "== sustained load at the largest tier (${WAREHOUSE_RECETTE_SUSTAINED_SECONDS:-600} s)"
  bench sustained "${WAREHOUSE_RECETTE_SUSTAINED_SECONDS:-600}"
fi
echo "== restore drill"
npx tsx scripts/warehouse/restore-drill.ts --out "$OUT/restore-drill.json" > /dev/null
node scripts/warehouse/recette-summary.mjs "$OUT" >/dev/null
echo "== done: $OUT (SUMMARY.md)"
