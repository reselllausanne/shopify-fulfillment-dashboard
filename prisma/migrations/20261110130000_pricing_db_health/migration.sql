-- Pricing / DB health (2026-11-10).
--
-- Index changes (CONCURRENTLY, cannot run inside a Prisma migration transaction) live in:
--   ops/sql/20261110_pricing_db_health_concurrent.sql
-- Run that script before or after `prisma migrate deploy`; order does not matter for app code.
--
-- This migration only carries transaction-safe storage parameters.
-- All statements take SHARE UPDATE EXCLUSIVE (no read/write blocking) and are idempotent.

-- Leave free space on each page so UPDATEs can be HOT (same page, no index rewrite).
-- Applies to newly written / vacuumed pages; no table rewrite.
ALTER TABLE "public"."SupplierVariant" SET (fillfactor = 85);
ALTER TABLE "public"."VariantMapping" SET (fillfactor = 90);
ALTER TABLE "public"."ChannelListingState" SET (fillfactor = 90);

-- Default autovacuum_vacuum_scale_factor = 0.2 means ~700k dead tuples are tolerated on a
-- 3.5M-row table before vacuum starts (20 % dead observed on SupplierVariant, 14 % KickDBVariant,
-- last KickDBVariant autovacuum was a month old). Vacuum earlier, in smaller, cheaper passes.
ALTER TABLE "public"."SupplierVariant" SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.01,
  autovacuum_vacuum_cost_limit = 800
);
ALTER TABLE "public"."VariantMapping" SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.01,
  autovacuum_vacuum_cost_limit = 800
);
ALTER TABLE "public"."ChannelListingState" SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.01
);
ALTER TABLE "public"."KickDBVariant" SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.01
);
ALTER TABLE "public"."KickDBProduct" SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);

-- Galaxus feed snapshots are rewritten wholesale every run (111M inserts / 109M deletes lifetime).
ALTER TABLE "public"."GalaxusFeedStockSnapshot" SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.01
);
ALTER TABLE "public"."GalaxusFeedOfferSnapshot" SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.01
);
