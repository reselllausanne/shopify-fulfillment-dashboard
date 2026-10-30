#!/usr/bin/env bash
# Dump Galaxus master+specs snapshot tables to CSV via Postgres COPY (fast, flat memory).
# Usage: bash scripts/dump-galaxus-master-specs-snapshot-csv.sh /path/to/outdir
#
# Headers MUST match MASTER_CSV_HEADERS / SPECS_CSV_HEADERS — bare expressions with
# HEADER true produce coalesce,?column? and Galaxus rejects the file.
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
  -c "\\copy (
    SELECT
      COALESCE(\"rowJson\"->>'ProviderKey', \"providerKey\") AS \"ProviderKey\",
      \"rowJson\"->>'Gtin' AS \"Gtin\",
      \"rowJson\"->>'ManufacturerKey' AS \"ManufacturerKey\",
      \"rowJson\"->>'BrandName' AS \"BrandName\",
      \"rowJson\"->>'ProductCategory' AS \"ProductCategory\",
      \"rowJson\"->>'ProductTitle_de' AS \"ProductTitle_de\",
      \"rowJson\"->>'ProductTitle_en' AS \"ProductTitle_en\",
      \"rowJson\"->>'ProductTitle_ch' AS \"ProductTitle_ch\",
      \"rowJson\"->>'VariantName' AS \"VariantName\",
      \"rowJson\"->>'LongDescription_de' AS \"LongDescription_de\",
      \"rowJson\"->>'MainImageUrl' AS \"MainImageUrl\",
      \"rowJson\"->>'ImageUrl_1' AS \"ImageUrl_1\",
      \"rowJson\"->>'ImageUrl_2' AS \"ImageUrl_2\"
    FROM \"GalaxusFeedMasterSnapshot\"
    ORDER BY \"providerKey\"
  ) TO '/out/ProductData_resell_lausanne.csv' WITH (FORMAT csv, HEADER true)"

docker run --rm --network "$NETWORK" -v "$OUT_DIR:/out" "$PSQL_IMAGE" \
  psql "$URL" -v ON_ERROR_STOP=1 \
  -c "SET statement_timeout=0" \
  -c "\\copy (
    SELECT
      COALESCE(\"rowJson\"->>'ProviderKey', \"providerKey\") AS \"ProviderKey\",
      COALESCE(\"rowJson\"->>'SpecificationKey', \"specificationKey\") AS \"SpecificationKey\",
      COALESCE(\"rowJson\"->>'SpecificationValue', '') AS \"SpecificationValue\"
    FROM \"GalaxusFeedSpecsSnapshot\"
    ORDER BY \"providerKey\", \"specificationKey\"
  ) TO '/out/SpecificationData_resell_lausanne.csv' WITH (FORMAT csv, HEADER true)"

# Sanity: Galaxus requires real header names (not coalesce/?column?).
head -1 "$OUT_DIR/ProductData_resell_lausanne.csv" | grep -q '^ProviderKey,' \
  || { echo "FATAL: master CSV header invalid: $(head -1 "$OUT_DIR/ProductData_resell_lausanne.csv")" >&2; exit 4; }
head -1 "$OUT_DIR/SpecificationData_resell_lausanne.csv" | grep -q '^ProviderKey,' \
  || { echo "FATAL: specs CSV header invalid: $(head -1 "$OUT_DIR/SpecificationData_resell_lausanne.csv")" >&2; exit 4; }

ls -lah "$OUT_DIR"
wc -l "$OUT_DIR"/ProductData_resell_lausanne.csv "$OUT_DIR"/SpecificationData_resell_lausanne.csv
echo "[dump-master-specs-csv] done"
