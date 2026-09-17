# Supplier stock reconciliation

Proof-based supplier stock system. **Absolute rule: no historical qty without fresh proof.**

StockX inbound is out of scope.

## Architecture

```
scrape run finishes
  → finalizeSupplierStockFromScrapeRun (hookScrape)
    → evaluateScrapeRunValidity
    → if invalid: invalid-run policy (2nd consecutive → pause + email)
    → if valid + complete snapshot: upsert evidence, zero missing variants
  → attachAvailableStock applies publish gate (unless manualLock)
```

### Tables

| Table | Purpose |
|-------|---------|
| `supplier_stock_policies` | Per-supplier approval/monitoring/pause state |
| `supplier_variant_evidence` | Last proven qty + availability per variant |
| `supplier_stock_review_items` | Human review queue |
| `supplier_scrape_quality_runs` | Run validity audit trail |

### Policy statuses

- `monitoring_only` — WEL, REI; reports + validity tracking; **does not alter live export qty**
- `review_required` — default for new suppliers; blocks marketplace publish until `approved`
- `approved` — publish allowed when fresh proof exists
- `paused_due_to_scrape_failure` — 2 consecutive invalid runs (non-monitoring suppliers)
- `manually_paused` — ops override

### Publish gate

`attachAvailableStock` loads policy + evidence maps. Unless `manualLock`:

1. Paused → 0
2. `review_required` → 0
3. `monitoring_only` → passthrough `baseStock` (WEL/REI safe window)
4. `approved` without fresh `lastProofAt` (48h) → 0
5. `approved` with fresh evidence → `evidence.publishedQty`

Published qty uses half-ceiling: 1→1, 2→1, 3→2, 4→2, 5→3.

## Run validity

Invalid when any of:

- `listed=0` + `wrote=0` while active catalog > 0
- Cloudflare/challenge in run message
- Volume drop vs prior listed
- Error rate high with low coverage
- Mostly empty parse (`listed` high, `wrote=0`)

Invalid runs **do not** zero historical stock (no cascade on bad data).

## Known anomaly root causes

### Ex Libris (`exl`)

Empty run `listed=0` / `wrote=0` left ~93k historical stock in DB. No invalid-run cascade existed — stale qty kept publishing. Fixed by `listed_zero_with_active_catalog` invalid reason + publish gate requiring fresh proof.

### FantasyWelt (`fan`)

Cloudflare error page left ~4400 variants showing in stock. Run marked invalid (`cloudflare_block`); gate zeros publish without proof.

### Warenkontor (`wrk`)

Shopify scraper uses `trustAvailableWhenQtyHidden` — delisted products never get stale-zeroed, so `listed < stock-in-db`. Complete-snapshot zeroing only runs on **valid** full runs; WRK needs careful monitoring of listed vs DB counts.

### Baby-Walz (`bwz`)

`listed=products` vs `wrote=variants` (multi-variant products). Metric confusion — high listed with moderate wrote is not necessarily inflation; validity uses both metrics.

### Venova (`ven`)

`defaultStock` when Sofort + schema.org without exact qty. System requires explicit qty proof path; defaultStock observations flagged for review.

### Hawk (`haw`)

`parseAvailability` treated empty/preorder/backorder as in stock; combined with `defaultStock=5` inflated catalog. Fixed: only `InStock` counts; empty → not in stock.

## Reichelt exclusions

Neon products and any unit dimension edge > 1.20 m excluded via `exclusions.ts` (shared with Galaxus feed integrity rules).

## Ops

### Dashboard

`/supplier-stock` — review queue by supplier, policy actions, quality runs.

### APIs

- `GET/PATCH /api/supplier-stock/review`
- `GET/PATCH /api/supplier-stock/policies`
- `GET /api/supplier-stock/runs`

### CLI

```bash
# Validity dry-run (Ex Libris empty-run scenario)
npx tsx scripts/supplier-stock-dry-run.ts --supplier=exl --listed=0 --wrote=0 --priorActive=90000

# Seed policies
npx tsx scripts/supplier-stock-dry-run.ts --seed-policies
```

### Alerts

Email via Postmark when supplier paused after 2 invalid runs. SMS/WhatsApp stubs if Twilio/Meta creds present (unwired).

## Scrape hook

`POST /api/scraper/scrape` calls `finalizeSupplierStockFromScrapeRun` in `.finally()` after each background scrape.
