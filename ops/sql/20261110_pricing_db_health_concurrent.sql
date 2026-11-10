-- ops/sql/20261110_pricing_db_health_concurrent.sql
-- Pricing / DB health — MUST run outside a Prisma migration transaction (autocommit ON).
-- Safe to re-run (idempotent). Do NOT wrap in BEGIN/COMMIT.
--
-- Project: nhxgqbqzevbblhlgfffb (resell-lausanne-db)
--
-- Why (investigation 2026-11-10, Galaxus prices stale up to 41 h):
--   * SupplierVariant took 113M UPDATEs with only 7 % HOT. Every "touch"
--     (lastSyncAt/updatedAt) rewrote ALL 10 indexes (2.9 GB) because updatedAt and
--     galaxusFeedDirty are indexed → page-level write amplification, 20 % dead tuples,
--     autovacuum running 24/7, IO-bound DB, statement timeouts at 03:00-05:00 UTC.
--   * SupplierVariant_updatedAt_idx: 497 MB, 3,149 scans in ~11 months.
--   * SupplierVariant_galaxusFeedDirty_idx: 58 MB, 8 scans (column no longer in schema.prisma).
--   * VariantMapping: two ~1 GB cursor indexes (supplierKey,[status],updatedAt,id) with
--     14.5k / 2.8k scans in ~11 months — feed paginates by id, never by these.
--   * SupplierVariant_normalized_gtin_idx was approved on 2026-09-19 but never created
--     in prod → regexp_replace(gtin,'^0+','') queries ran 9 s (seq scan, 3.5M rows).

-- ---------------------------------------------------------------------------
-- 0) Preconditions (read-only)
-- ---------------------------------------------------------------------------
SELECT relname, n_tup_upd, n_tup_hot_upd,
       round(100.0 * n_tup_hot_upd / nullif(n_tup_upd, 0), 1) AS hot_pct
FROM pg_stat_user_tables
WHERE relname IN ('SupplierVariant', 'VariantMapping');

-- ---------------------------------------------------------------------------
-- 1) Expression index for normalized GTIN lookups (9 s -> index scan).
--    Exact match to app SQL: regexp_replace(sv."gtin", '^0+', '')
--    gtin is set on INSERT only, so this index never blocks HOT updates.
-- ---------------------------------------------------------------------------
CREATE INDEX CONCURRENTLY IF NOT EXISTS "SupplierVariant_normalized_gtin_idx"
  ON "public"."SupplierVariant" ((regexp_replace("gtin", '^0+', '')));

-- ---------------------------------------------------------------------------
-- 2) Drop indexes that block HOT updates / are never used
-- ---------------------------------------------------------------------------
-- 2a) Image-sync backlog partial index keyed on updatedAt also blocked HOT (PG treats every
--     column in key OR predicate as "indexed"). Replace with same predicate, key supplierVariantId
--     (predicate columns hostedImageUrl/imageSyncStatus change rarely). Create new BEFORE dropping old.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "SupplierVariant_imageSync_backlog_partial_idx"
  ON "public"."SupplierVariant" USING btree ("supplierVariantId")
  WHERE ((("hostedImageUrl" IS NULL)
          OR ("imageSyncStatus" = ANY (ARRAY['PENDING'::text, 'FAILED'::text]))
          OR ("hostedImageUrl" ~~ '%.avif'::text)
          OR ("hostedImageUrl" ~~ '%.webp'::text)
          OR ("hostedImageUrl" ~~ '%.gif'::text))
         AND (("supplierVariantId" ~~* 'stx:%'::text)
          OR ("supplierVariantId" ~~* 'stx_%'::text)
          OR ("supplierVariantId" ~~* 'the:%'::text)
          OR ("supplierVariantId" ~~* 'the_%'::text)));
DROP INDEX CONCURRENTLY IF EXISTS "public"."SupplierVariant_imageSync_updatedAt_partial_idx";

-- 2b) Unused / HOT-blocking
DROP INDEX CONCURRENTLY IF EXISTS "public"."SupplierVariant_galaxusFeedDirty_idx";
DROP INDEX CONCURRENTLY IF EXISTS "public"."SupplierVariant_updatedAt_idx";
DROP INDEX CONCURRENTLY IF EXISTS "public"."VariantMapping_supplierKey_status_updatedAt_id_idx";
DROP INDEX CONCURRENTLY IF EXISTS "public"."VariantMapping_feed_scope_updatedAt_id_partial_idx";

-- ---------------------------------------------------------------------------
-- 3) Verify
-- ---------------------------------------------------------------------------
SELECT tablename, indexname, pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_indexes i
JOIN pg_stat_user_indexes s ON s.indexrelname = i.indexname AND s.schemaname = i.schemaname
WHERE i.tablename IN ('SupplierVariant', 'VariantMapping')
ORDER BY i.tablename, pg_relation_size(s.indexrelid) DESC;
-- Expect: no updatedAt_idx / galaxusFeedDirty_idx on SupplierVariant,
--         normalized_gtin_idx present, 2 fewer VariantMapping indexes.

-- Re-check HOT ratio in a few hours/days (stats are cumulative; watch the delta):
--   SELECT n_tup_upd, n_tup_hot_upd FROM pg_stat_user_tables WHERE relname = 'SupplierVariant';
