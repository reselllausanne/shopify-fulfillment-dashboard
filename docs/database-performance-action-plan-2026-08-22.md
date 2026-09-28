# Database performance action plan (safe-first)

Goal: reduce DB egress and CPU without risking feed push or data integrity.

## Applied in code (done)

- `galaxus/kickdb/enrichJob.ts`
  - Added explicit `select` for hot `SupplierVariant` reads.
  - Kept only fields needed by logic.
  - Avoids loading full row payload on each enrich pass.
- `galaxus/warehouse/theCatalogStock.ts`
  - Added minimal `select` on `findFirst`/`findUnique`.
- `galaxus/partners/partnerOrderStock.ts`
  - Added `select: { stock: true }` on stock deduction lookups.
- `decathlon/orders/pollOrders.ts`
  - Added `select: { price: true }` for return-price fallback lookups.
- `app/api/decathlon/returns/[lineId]/restock/route.ts`
  - Added `select: { price: true }` for restock price fallback lookups.
- `galaxus/partners/enrichUploadJob.ts`
  - Added minimal `select` on providerKey+gtin lookup.

## DB ops from PDF (not auto-run here)

**Superseded for Phase 1–2 (2026-09-19):** see [`docs/DB-PERF-PHASE1-2-RUNBOOK.md`](./DB-PERF-PHASE1-2-RUNBOOK.md) and `ops/sql/20260919_db_perf_phase2_concurrent.sql`.

Key corrections vs this older draft:

- Expression index must use `((regexp_replace("gtin", '^0+', '')))` — not bare column form.
- DROP only the GIN `targeted_campaign_ids` index for now (`last_seen` / `is_current` held; `shopify_variant_id` kept).
- CONCURRENTLY DDL must **not** live in Prisma transactional migrations.
- VariantMapping REINDEX held until pgstatindex/pgstattuple proof.
- VACUUM FULL still deferred.

### Historical (do not copy-paste blindly)

These are low-risk-first operations. Run manually in DB console.

### 1) Drop unused indexes (concurrent, no table lock)

```sql
SELECT indexrelname, idx_scan, pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes
WHERE relname = 'ads_shopping_product_current'
  AND indexrelname IN (
    'ads_shopping_product_current_last_seen_run_id_idx',
    'ads_shopping_product_current_shopify_variant_id_idx',
    'ads_shopping_product_current_targeted_campaign_ids_gin_idx'
  );

-- Approved 2026-09-19: GIN only
DROP INDEX CONCURRENTLY IF EXISTS ads_shopping_product_current_targeted_campaign_ids_gin_idx;
```

### 2) Add GTIN expression index (concurrent, no table lock)

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS "SupplierVariant_normalized_gtin_idx"
ON "SupplierVariant" ((regexp_replace("gtin", '^0+', '')));
```

### 3) Vacuum analyze stale table (no read/write blocking)

```sql
VACUUM (ANALYZE, VERBOSE) "StxImportSlug";
```

### 4) Reindex hot VariantMapping indexes (concurrent) — HOLD

See `ops/sql/20260919_variantmapping_reindex_HOLD.sql`.

## High-risk ops deferred

Deferred intentionally to avoid feed disruption:

- `VACUUM FULL "SupplierVariant"` (exclusive lock)
- `VACUUM FULL ads_shopping_product_current` (exclusive lock)

Run only in low-traffic maintenance window.

