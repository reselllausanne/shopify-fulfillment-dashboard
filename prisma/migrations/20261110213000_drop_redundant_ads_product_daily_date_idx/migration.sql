-- ads_product_daily_date_idx (date) is redundant with the unique key
-- ads_product_daily_key (date, campaign_id, merchant_id, feed_label, language_code, offer_id): 210 MB.
-- Prod already dropped it with DROP INDEX CONCURRENTLY; IF EXISTS keeps fresh databases in sync.
DROP INDEX IF EXISTS "public"."ads_product_daily_date_idx";
-- Unused GIN (0 scans) on ads_shopping_product_current; already removed from schema.prisma earlier,
-- the real drop is ops/sql/20260919_db_perf_phase2_concurrent.sql (executed in prod 2026-11-10).
DROP INDEX IF EXISTS "public"."ads_shopping_product_current_targeted_campaign_ids_gin_idx";
