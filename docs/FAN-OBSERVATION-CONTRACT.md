# FAN observation contract

FantasyWelt emits `SupplierVariantObservation` proofs. `SUPPLIER_STOCK_PUBLISH_ENFORCED` stays unset — no marketplace qty writes.

## Qty rules

| Case | Formula |
|---|---|
| Exact `N Stk. auf Lager` + SOFORT | `ceil(N/2)` (1→1) |
| SALE URL (`/SALE-` or `%SALE%`) | `max(0, ceil((N - 2) / 2))` |
| `10+ Stk. auf Lager` | treat as **10**, then apply formula above |
| VORBESTELLBAR / 0 Stk / Cloudflare / no Stk line | proposed **0**, no positive proof |
| Default 5 | **never** |

## Dashboard

`/supplier-stock` → Source evidence table (URL, source qty, proposed, reason, raw JSON).  
API: `GET /api/supplier-stock/evidence?supplier=fan`

## Scrape

`scrapeFantasyweltShop` records observations per PDP; runner drains them into finalize.
Local `SupplierVariant.stock` may store proposed qty for ops visibility; Galaxus/Decathlon still gated by enforce flag.
