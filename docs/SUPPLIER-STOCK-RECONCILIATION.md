# Supplier stock reconciliation

**Absolute rule:** a quantity may be published only when the scraper proved, on the **current** supplier page, the variant identity, price, stock/buyability, and absence of preorder/backorder.  
**`SupplierVariant.stock` is historical — never fresh proof.** It must not set `lastProofAt` or renew publishable qty.

StockX is out of scope.

## Enforcement switch (mandatory safety)

| Env | Mode | Marketplace qty |
|-----|------|-----------------|
| `SUPPLIER_STOCK_PUBLISH_ENFORCED` absent / ≠`1` | **OBSERVATION_ONLY_NOT_ENFORCED** | **unchanged** — dashboard, reports, review, alerts only |
| `SUPPLIER_STOCK_PUBLISH_ENFORCED=1` | enforced | policies apply: WEL/REI `TEMPORARY_MONITORING_EXCEPTION`; unapproved → 0; approved only with fresh `SupplierVariantObservation` |

Dashboard shows a prominent `OBSERVATION_ONLY_NOT_ENFORCED` banner until the flag is set.

### Activation runbook

1. Deploy code (migration tables only — no seed). Confirm banner = observation-only.
2. Qualify **one** supplier via [SUPPLIER-OBSERVATION-QUALIFICATION.md](./SUPPLIER-OBSERVATION-QUALIFICATION.md).
3. Wire that scraper to `observationAdapter` + set `observationContractImplemented=true` in `contractRegistry.ts`.
4. Run scrapes; verify `observationsReceivedThisRun` / `sourceProofCoverage` on `/supplier-stock`.
5. Manually approve that supplier (`observationContractValidated=true`) — blocked if contract not implemented.
6. Only when ready to cut marketplace qty: set `SUPPLIER_STOCK_PUBLISH_ENFORCED=1` on the server and restart.
7. WEL/REI stay `monitoring_only` during freeze — alerts only, no qty change.

**Never** enable the flag before at least one supplier is validated, unless you intentionally want all non-approved scrapers to publish 0.

## Observation contract (`SupplierVariantObservation`)

Scrapers must emit a structured payload per variant for the current run:

| Field | Required for proof |
|-------|-------------------|
| supplierKey, supplierVariantId | yes |
| productUrl and/or variantUrl | yes |
| gtin **or** manufacturerRef **or** supplierSku | yes |
| sourcePrice (live) | yes |
| purchaseSignal (add to cart / InStock / Stück an Lager / …) | yes when in_stock |
| sourceAvailability | yes (`in_stock` / `out_of_stock` / `preorder` / `backorder` / `unavailable` / `unknown`) |
| supplierStockQty **or** quantityUnknown=true | yes when in_stock |
| scrapeRunId + observedAt | yes |

Without this payload: `publishedQty=0`, reason `NO_FRESH_SOURCE_EVIDENCE`, review queue.  
`usedDefaultStock=true` can never become published qty.

**Honesty:** runner call sites finalize runs — they do **not** prove pages. Until a scraper implements the contract:

| Field | Meaning |
|-------|---------|
| `observationContractImplemented` | code registry — false for all today |
| `observationsReceivedThisRun` | count of observation payloads this finalize |
| `sourceProofCoverage` | share with fresh proof |
| `eligibleForApproval` | false if contract not implemented |

A source **cannot** be marked `approved` if `observationContractImplemented=false`.

## Quantities

| Source proof | Published |
|--------------|-----------|
| exact n | `ceil(n/2)` → 1→1, 2→1, 3→2, 4→2, 5→3 |
| confirmed sellable, qty hidden | **1 max** |
| preorder / backorder / unavailable / no proof | **0** + review |

## Snapshot completeness

Missing variants → qty 0 **only when enforced** and:

1. scraper declares `snapshotCompleteness: "full"`
2. run is not partial (`max`, pagination stop, incomplete categories, …)
3. status is success (`ok` **or** `completed`)
4. coverage vs last reliable full snapshot ≥ **80%** (per-supplier config; never 5%)

`listed` / `wrote` alone do **not** prove exhaustiveness (products vs variants / GTIN-only writes).  
If not full: do **not** zero absents; open coverage review if drop is abnormal.

## Run statuses

Success (may reset `consecutiveInvalidRuns`): `ok`, `completed`  
Invalid (never reset counter): `error`, `failed`, `running`, `cancelled`, `interrupted`, missing `finished_at`

## Two consecutive invalid runs

| Policy | 1st invalid | 2nd invalid |
|--------|-------------|-------------|
| **approved** | keep last proof ≤ **24h** (`FIRST_INVALID_GRACE_MS`) | email + marketplace stock → 0 + `paused_due_to_scrape_failure` (**only if enforced**) |
| **review_required** | already marketplace 0 when enforced | email + pause |
| **monitoring_only** (WEL/REI) | track | **alert only** — tag `TEMPORARY_MONITORING_EXCEPTION` — **no qty change** during 2–3 day freeze |

## Central runner

All scrapes must go through `app/lib/scraperRunner.ts` → finalize exactly once.

| Call site | Path |
|-----------|------|
| API | `POST /api/scraper/scrape` → `runScraperJob` |
| VPS cron | `scripts/scrape-cron.sh` → API |
| CLI | `scripts/run-*-scrape.ts` → `runScraperJob` |
| Detached | `run-*-detached.sh` → CLI |

Verify: `npx tsx scripts/supplier-stock-dry-run.ts --call-sites`

Adapter interface: `inventory/supplierStock/observationAdapter.ts` — register one supplier at a time. Do not claim call sites = page proof.

## Notifications

- Email Postmark: preflight `configured` | `recipient_missing` | `not_configured` | `send_failed` | `sent`
- SMS / WhatsApp: **not implemented** (may show `credentials_present_unwired` — never “delivered”)

## Deploy policy

- Migration = **tables only**
- **No auto seed in production**
- Staging/local seed only: `SUPPLIER_STOCK_ALLOW_SEED=1 npx tsx scripts/supplier-stock-dry-run.ts --seed-policies`
- Activate suppliers one-by-one after manual review
- WEL/REI: monitoring freeze — feed unchanged
- Others: `review_required` → marketplace 0 **only after** `SUPPLIER_STOCK_PUBLISH_ENFORCED=1`

## Example quality reports

### EXL (empty run)

```json
{
  "valid": false,
  "invalidReason": "listed_zero_with_active_catalog",
  "snapshotCompleteness": "partial",
  "observationContractPresent": false,
  "observationContractImplemented": false,
  "observationsReceivedThisRun": 0,
  "eligibleForApproval": false,
  "enforceMode": "observation_only",
  "banner": "OBSERVATION_ONLY_NOT_ENFORCED",
  "note": "NO historical SupplierVariant.stock used as proof"
}
```

### FAN (Cloudflare)

```json
{
  "valid": false,
  "invalidReason": "cloudflare_block",
  "incompletenessReason": "cloudflare_or_challenge"
}
```

### HAW (healthy but no observation contract yet)

```json
{
  "valid": true,
  "completeSnapshot": false,
  "observationContractPresent": false,
  "observationContractImplemented": false,
  "incompletenessReason": "observation_contract_missing",
  "marketplacePublishStatus": "review_required"
}
```

### VEN (defaultStock without exact qty)

```json
{
  "zeroReason": "default_stock_not_allowed_as_proof",
  "needsReview": true,
  "publishedQty": 0
}
```

## Dry-run

```bash
npx tsx scripts/supplier-stock-dry-run.ts --supplier=exl --listed=0 --wrote=0 --priorActive=90000
npx tsx scripts/supplier-stock-dry-run.ts --supplier=haw --status=completed --listed=9000 --wrote=8500 --priorActive=10000 --snapshot=full
npx vitest run inventory/supplierStock/supplierStock.test.ts
```
