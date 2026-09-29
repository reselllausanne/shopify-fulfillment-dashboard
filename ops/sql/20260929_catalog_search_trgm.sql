-- Catalog search (Pricing / View DB search bars + live suggestions).
-- Run OUTSIDE a transaction (CONCURRENTLY). Non-blocking for writes; builds in a few minutes on ~2M rows.
-- Expression must stay identical to CATALOG_SEARCH_DOC_SQL in app/lib/catalogSearch.ts.
--
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS "SupplierVariant_search_doc_trgm_idx";

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "SupplierVariant_search_doc_trgm_idx"
  ON "SupplierVariant"
  USING gin (
    regexp_replace(lower(coalesce("supplierProductName", '') || '|' || coalesce("supplierSku", '')), '[^a-z0-9|]+', '', 'g')
    gin_trgm_ops
  );
