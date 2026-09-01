#!/usr/bin/env bash
# Resume-friendly Ex Libris listing crawl (~1 req/s). Ctrl-C safe — rerun with same args.
set -euo pipefail
cd "$(dirname "$0")/.."

CATALOG="${EXLIBRIS_CATALOG:-spiele}"
LIMIT="${EXLIBRIS_LIMIT:-0}"
DELAY="${EXLIBRIS_DELAY:-1.0}"
FLUSH="${EXLIBRIS_FLUSH_EVERY:-100}"

exec python3 scripts/scrape_exlibris.py \
  --catalog "$CATALOG" \
  --limit "$LIMIT" \
  --delay "$DELAY" \
  --flush-every "$FLUSH" \
  --resume \
  --checkpoint data/exlibris_checkpoint.json \
  --out data/exlibris_products.csv \
  --meta-out data/exlibris_scrape_meta.json
