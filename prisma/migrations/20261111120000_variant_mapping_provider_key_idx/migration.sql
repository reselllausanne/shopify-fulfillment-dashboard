-- Live Galaxus snapshot patches (and any providerKey lookup) filter VariantMapping by
-- "providerKey" IN (...) ORDER BY id DESC LIMIT n. With no index on providerKey the planner
-- walks the whole table: ~46k blocks (~360 MB) read per patch, ~1.4 s, ~200 GB of disk reads
-- per 3 h at ~3 patches/min, and it thrashes the shared cache for every other query.
--
-- Prod: already created with CREATE INDEX CONCURRENTLY (no write lock) over a direct
-- connection; this statement is then a no-op. Partial (NULLs are 560k of 3.4M rows).
-- Not modelled in schema.prisma (partial), like VariantMapping_export_cursor_idx.
CREATE INDEX IF NOT EXISTS "VariantMapping_providerKey_idx"
  ON "VariantMapping" ("providerKey")
  WHERE "providerKey" IS NOT NULL;
