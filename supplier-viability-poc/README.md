# Supplier viability POC — Galaxus CH electronics

Read-only commercial+technical POC for **Farnell**, **Bürklin**, **BerryBase**, **Pollin**.

Does **not** publish offers. Does **not** write production. Secrets never logged.

## Quick start

```bash
# 1) Export project Galaxus/SupplierVariant GTIN index (needs DATABASE_URL)
node scripts/export_gtin_index.mjs

# 2a) Live scrape (1 req/s, robots-aware) — per supplier:
python3 scrape_suppliers.py --supplier pollin --limit 300
python3 scrape_suppliers.py --supplier berrybase --limit 300
python3 scrape_suppliers.py --supplier farnell --limit 300   # needs FARNELL_API_KEY
python3 scrape_suppliers.py --supplier buerklin --limit 300  # may stop on Cloudflare
python3 scrape_suppliers.py --supplier exlibris --limit 300 --catalog spiele

# 2a-exlibris) Long crawl (checkpoint/resume, ~94k Spiele @ 1 req/s ≈ 1 day listings-only):
python3 scripts/scrape_exlibris.py --catalog spiele --limit 0 --delay 1.0 --resume
# or:
bash scripts/run_exlibris_day.sh

# 2b) If bulk fetch is blocked in this environment: curl PDPs into _raw/*/products/
#     then finalize:
python3 scripts/finalize_from_raw.py

# 3) Match + profitability (also done by finalize / run_poc)
python3 match_galaxus.py
python3 calculate_profitability.py
```

Report: `reports/supplier_viability_report.md`

## Reused project logic

| Concern | Source |
|---|---|
| GTIN checksum | Same GS1 algorithm as `galaxus/exports/feedValidation.ts` `isValidGtin` |
| Target net margin 12% | `galaxus/exports/pricing.ts` `DEFAULT_TARGET_MARGIN` |
| EURCHF 0.94 | `galaxus/exports/pricing.ts` GLD default |
| No Mirakl commission | `galaxus/orders/margin.ts` (Galaxus B2B) |
| GTIN index | `SupplierVariant.gtin`, `ChannelListingState`, `GalaxusOrderLine` |

## Critical catalog gap

Project Galaxus data is **sneakers/apparel** (StockX etc.), not Digitec electronics. Exact GTIN overlap with electronics wholesalers is expected near zero until an electronics sell catalog is imported.

## Status labels

`VIABLE_NOW` only if: valid GTIN + exact Galaxus match + identical packaging signals + live price/stock + CH delivery confirmed + margin ≥ 12% after all known costs + no blocking MOQ.

Unknown freight/customs ⇒ `SHIPPING_UNCONFIRMED` (never treat shipping as 0).

## Tests

```bash
python3 -m unittest tests.test_gtin tests.test_parsers -v
```

## Layout

```
supplier-viability-poc/
  scrape_suppliers.py
  match_galaxus.py
  calculate_profitability.py
  run_poc.py
  config.example.json
  data/*.csv
  reports/supplier_viability_report.md
  tests/
  scripts/
```
