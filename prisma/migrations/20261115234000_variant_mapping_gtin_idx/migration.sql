-- Warehouse pack scan resolves product name/size with
-- VariantMapping.gtin IN (...). No gtin index → seq scan of the whole
-- catalog (~3.3M rows, ~1s) on every eligible load, and it grows with the feed.
--
-- Prod: create with CREATE INDEX CONCURRENTLY (no write lock) on a direct
-- connection first. This statement is then a no-op. Safe inside a migration
-- transaction because it is not CONCURRENTLY.
CREATE INDEX IF NOT EXISTS "VariantMapping_gtin_idx"
  ON "VariantMapping" ("gtin");
