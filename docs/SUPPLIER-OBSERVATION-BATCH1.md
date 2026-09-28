# Observation batch 1 (HAW / BWZ / TUS / EXL / VEN / WRK / FAN)

`SUPPLIER_STOCK_PUBLISH_ENFORCED` stays **unset**.

- Evidence + review only
- **No** `SupplierVariant.stock` writes when flag off (`stockFieldForUpsert`)
- **No** marketplace uploads from this path

## Qty formulas (validated)

| Key | Rule |
|-----|------|
| FAN | halfCeil(N); SALE max(0,ceil((N-2)/2)); 10+→10 then formula |
| HAW | Lagerbestand/Stück an Lager → halfCeil; external → 0; never default 5 |
| BWZ | NUXT qty → halfCeil; Gutscheine excluded |
| TUS | Verfügbar:N → halfCeil; Nicht vorrätig → 0 |
| EXL | 2–3/2–4 Werktage → 1; vergriffen → 0; empty scrape ≠ proof |
| VEN | buyable page obs → 1; ignore sQuantity max / default 100 |
| WRK | tracked Shopify qty → halfCeil; hidden qty not invented |

## Dashboard

`/supplier-stock` evidence: **DB actuel | preuve live | proposée | delta | raison | URL**

## After deploy

1. Scrape FAN (proxy/headed path), HAW, BWZ, TUS, EXL, VEN, WRK
2. Review deltas on dashboard
3. Do **not** set enforce flag until human approve
