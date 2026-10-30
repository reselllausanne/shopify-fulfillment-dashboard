#!/usr/bin/env bash
# Dump Galaxus master+specs snapshot tables to CSV via Postgres COPY (fast, flat memory).
# Usage: bash scripts/dump-galaxus-master-specs-snapshot-csv.sh /path/to/outdir
set -euo pipefail

OUT_DIR="${1:?outdir required}"
mkdir -p "$OUT_DIR"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Load DB URLs without sourcing the whole .env (unquoted values break `source`).
DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | sed 's/\r$//' | sed 's/^"//;s/"$//')"
DIRECT_URL="$(grep -E '^DIRECT_URL=' .env | head -1 | cut -d= -f2- | sed 's/\r$//' | sed 's/^"//;s/"$//' || true)"
URL="${DIRECT_URL:-$DATABASE_URL}"
if [[ -z "$URL" ]]; then
  echo "FATAL: DATABASE_URL/DIRECT_URL missing" >&2
  exit 1
fi

NETWORK="${GALAXUS_COPY_DOCKER_NETWORK:-resell_default}"
PSQL_IMAGE="${GALAXUS_COPY_PSQL_IMAGE:-postgres:16-alpine}"

echo "[dump-master-specs-csv] out=$OUT_DIR network=$NETWORK"

docker run --rm --network "$NETWORK" -v "$OUT_DIR:/out" "$PSQL_IMAGE" \
  psql "$URL" -v ON_ERROR_STOP=1 \
  -c "SET statement_timeout=0" \
  -c "\\copy (SELECT COALESCE(\"rowJson\"->>'ProviderKey',\"providerKey\"), \"rowJson\"->>'Gtin', \"rowJson\"->>'ManufacturerKey', \"rowJson\"->>'BrandName', \"rowJson\"->>'ProductCategory', \"rowJson\"->>'ProductTitle_de', \"rowJson\"->>'ProductTitle_en', \"rowJson\"->>'ProductTitle_ch', \"rowJson\"->>'VariantName', \"rowJson\"->>'LongDescription_de', \"rowJson\"->>'MainImageUrl', \"rowJson\"->>'ImageUrl_1', \"rowJson\"->>'ImageUrl_2' FROM \"GalaxusFeedMasterSnapshot\" ORDER BY \"providerKey\") TO '/out/ProductData_resell_lausanne.csv' WITH (FORMAT csv, HEADER true)"

docker run --rm --network "$NETWORK" -v "$OUT_DIR:/out" "$PSQL_IMAGE" \
  psql "$URL" -v ON_ERROR_STOP=1 \
  -c "SET statement_timeout=0" \
  -c "\\copy (SELECT COALESCE(\"rowJson\"->>'ProviderKey',\"providerKey\"), COALESCE(\"rowJson\"->>'SpecificationKey',\"specificationKey\"), COALESCE(\"rowJson\"->>'SpecificationValue','') FROM \"GalaxusFeedSpecsSnapshot\" ORDER BY \"providerKey\", \"specificationKey\") TO '/out/SpecificationData_resell_lausanne.csv' WITH (FORMAT csv, HEADER true)"

ls -lah "$OUT_DIR"
wc -l "$OUT_DIR"/ProductData_resell_lausanne.csv "$OUT_DIR"/SpecificationData_resell_lausanne.csv
echo "[dump-master-specs-csv] done"
