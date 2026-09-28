-- ops/sql/20260919_variantmapping_reindex_HOLD.sql
-- HOLD — do not run until bloat/fragmentation is proven.
--
-- Heap ≈ 377 MB vs indexes ≈ 1.94 GB is NOT sufficient proof that REINDEX helps.
-- Before running:
--   1) Enable / use pgstattuple or pgstatindex
--   2) Confirm free disk headroom (~1–2 GB temp for largest index)
--   3) Reindex ONE index at a time with CONCURRENTLY, outside a transaction
--
-- Example measurement (requires extension):
--   CREATE EXTENSION IF NOT EXISTS pgstattuple;
--   SELECT * FROM pgstatindex('"VariantMapping_export_cursor_idx"');
--
-- If avg_leaf_density is poor / leaf_fragmentation high AND disk OK:
--   REINDEX INDEX CONCURRENTLY "VariantMapping_export_cursor_idx";
--   -- then next indexes one at a time

SELECT 'HOLD — see header comments' AS status;
