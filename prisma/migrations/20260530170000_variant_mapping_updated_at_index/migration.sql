-- Cursor pagination on VariantMapping needs fast ORDER BY updatedAt DESC, id DESC.
-- Without this index, every page does a full 178k-row sort.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "VariantMapping_updatedAt_id_idx"
  ON "VariantMapping" ("updatedAt" DESC, "id" DESC);
