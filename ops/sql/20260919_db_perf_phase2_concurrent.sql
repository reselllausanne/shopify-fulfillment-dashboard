-- ops/sql/20260919_db_perf_phase2_concurrent.sql
-- Phase 2 DB ops — MUST run outside a Prisma migration transaction.
-- Safe to re-run (idempotent).
--
-- Run via Supabase SQL editor / psql with autocommit ON (default).
-- Do NOT wrap in BEGIN/COMMIT.
-- Do NOT put CREATE/DROP INDEX CONCURRENTLY inside prisma/migrations.
--
-- Project: nhxgqbqzevbblhlgfffb (resell-lausanne-db)
-- Approved scope (2026-09-19 review):
--   1) CREATE expression index SupplierVariant_normalized_gtin_idx
--   2) VACUUM (ANALYZE) "StxImportSlug"
--   3) DROP GIN ads_shopping_product_current_targeted_campaign_ids_gin_idx only
-- Out of scope: last_seen / is_current drops, VariantMapping REINDEX, VACUUM FULL

-- ---------------------------------------------------------------------------
-- 0) Preconditions
-- ---------------------------------------------------------------------------
SELECT current_setting('server_version') AS pg_version, now() AS as_of;

SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname = 'SupplierVariant_normalized_gtin_idx';

SELECT indexrelname, idx_scan, pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes
WHERE relname = 'ads_shopping_product_current'
  AND indexrelname = 'ads_shopping_product_current_targeted_campaign_ids_gin_idx';

SELECT relname, n_dead_tup, last_vacuum, last_autovacuum
FROM pg_stat_user_tables
WHERE relname = 'StxImportSlug';

-- ---------------------------------------------------------------------------
-- 1) Expression index — exact match to app SQL:
--    regexp_replace(sv."gtin", '^0+', '')
-- Extra parentheses required for expression index.
-- ---------------------------------------------------------------------------
CREATE INDEX CONCURRENTLY IF NOT EXISTS "SupplierVariant_normalized_gtin_idx"
  ON "public"."SupplierVariant" ((regexp_replace("gtin", '^0+', '')));

-- Verify (expect Index Scan):
-- EXPLAIN (ANALYZE, BUFFERS)
-- SELECT id FROM "SupplierVariant"
-- WHERE regexp_replace("gtin", '^0+', '') = '191448538818';

-- ---------------------------------------------------------------------------
-- 2) StxImportSlug hygiene
-- ---------------------------------------------------------------------------
VACUUM (ANALYZE) "StxImportSlug";

SELECT relname, n_dead_tup, last_vacuum, last_autovacuum, last_analyze, last_autoanalyze
FROM pg_stat_user_tables
WHERE relname = 'StxImportSlug';

-- ---------------------------------------------------------------------------
-- 3) Drop unused ads GIN (idx_scan confirmed 0 over 259d window).
-- Column targeted_campaign_ids remains; only the unused GIN goes away.
-- last_seen_run_id / is_current indexes intentionally kept (rare scans).
-- ---------------------------------------------------------------------------
DROP INDEX CONCURRENTLY IF EXISTS "ads_shopping_product_current_targeted_campaign_ids_gin_idx";

SELECT indexrelname
FROM pg_stat_user_indexes
WHERE relname = 'ads_shopping_product_current'
  AND indexrelname = 'ads_shopping_product_current_targeted_campaign_ids_gin_idx';
-- Expect: 0 rows
