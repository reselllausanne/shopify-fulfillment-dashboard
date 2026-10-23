#!/usr/bin/env bash
# Build tmp_tracking/shopify-custom-pixel-ready.js from docs/tracking/shopify-custom-pixel.js
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/docs/tracking/shopify-custom-pixel.js"
OUT_DIR="$ROOT/tmp_tracking"
OUT="$OUT_DIR/shopify-custom-pixel-ready.js"
ENDPOINT="${FUNNEL_ENDPOINT:-https://solution.resell-lausanne.ch/api/track/funnel}"

KEY="${FUNNEL_TRACK_KEY:-}"
if [[ -z "$KEY" && -f "$ROOT/.env" ]]; then
  KEY_LINE="$(grep -E '^FUNNEL_TRACK_KEY=' "$ROOT/.env" | tail -1 || true)"
  KEY="${KEY_LINE#FUNNEL_TRACK_KEY=}"
  KEY="${KEY%$'\r'}"
  KEY="${KEY#\"}"
  KEY="${KEY%\"}"
  KEY="${KEY#\'}"
  KEY="${KEY%\'}"
fi
if [[ -z "$KEY" ]]; then
  echo "FUNNEL_TRACK_KEY missing (set in .env or env)" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
sed \
  -e "s|__FUNNEL_ENDPOINT__|$ENDPOINT|g" \
  -e "s|__FUNNEL_TRACK_KEY__|$KEY|g" \
  "$SRC" > "$OUT"
echo "Wrote $OUT ($(wc -c < "$OUT" | tr -d ' ') bytes)"
