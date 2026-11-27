-- Catalog list (ORDER BY updatedAt DESC LIMIT n) seq-scanned 3.3M rows (~77s).
-- Applied manually in prod with CREATE INDEX CONCURRENTLY; IF NOT EXISTS keeps this idempotent.
CREATE INDEX IF NOT EXISTS "SupplierVariant_updatedAt_idx" ON "SupplierVariant" ("updatedAt" DESC);
