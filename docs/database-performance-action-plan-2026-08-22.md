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

DROP INDEX CONCURRENTLY IF EXISTS ads_shopping_product_current_last_seen_run_id_idx;
DROP INDEX CONCURRENTLY IF EXISTS ads_shopping_product_current_shopify_variant_id_idx;
DROP INDEX CONCURRENTLY IF EXISTS ads_shopping_product_current_targeted_campaign_ids_gin_idx;
```

### 2) Add GTIN expression index (concurrent, no table lock)

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS "SupplierVariant_normalized_gtin_idx"
ON "SupplierVariant" (regexp_replace(gtin, '^0+', ''));
```

### 3) Vacuum analyze stale table (no read/write blocking)

```sql
VACUUM (ANALYZE, VERBOSE) "StxImportSlug";
```

### 4) Reindex hot VariantMapping indexes (concurrent)

```sql
REINDEX INDEX CONCURRENTLY "VariantMapping_export_cursor_idx";
REINDEX INDEX CONCURRENTLY "VariantMapping_supplierKey_status_updatedAt_id_idx";
REINDEX INDEX CONCURRENTLY "VariantMapping_feed_scope_updatedAt_id_partial_idx";
```

## High-risk ops deferred

Deferred intentionally to avoid feed disruption:

- `VACUUM FULL "SupplierVariant"` (exclusive lock)
- `VACUUM FULL ads_shopping_product_current` (exclusive lock)

Run only in low-traffic maintenance window.

