-- convergeAll() "dropship candidates" query: SupplierVariant rows with manualLock=true or a
-- 'phase4:dropship%' note (~4k rows of 4.1M). Without this it seq-scanned the whole table and
-- evaluated a correlated regexp NOT EXISTS: one call ran 588 s / ~95M buffer hits.
-- Predicate columns (manualLock, manualNote) are essentially never written by price/stock syncs,
-- so HOT updates are unaffected.
-- Prod: built with CREATE INDEX CONCURRENTLY over a direct connection; this is a no-op there.
CREATE INDEX IF NOT EXISTS "SupplierVariant_manual_candidates_idx"
  ON "SupplierVariant" ("supplierVariantId")
  WHERE "manualLock" = true OR "manualNote" LIKE 'phase4:dropship%';
