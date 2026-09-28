-- Intentionally no-op DDL.
--
-- Real drop of ads_shopping_product_current_targeted_campaign_ids_gin_idx is done by:
--   ops/sql/20260919_db_perf_phase2_concurrent.sql
-- using DROP INDEX CONCURRENTLY (forbidden inside a Prisma migration transaction).
--
-- This migration exists so prisma migrate history matches schema.prisma (GIN removed).
-- Run the ops SQL script before or after migrate deploy; order does not matter for app code.
SELECT 1;
