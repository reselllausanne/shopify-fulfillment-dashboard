-- loadWelCardOmitProviderKeys() filters SupplierVariant by "providerKey" ILIKE 'WEL\_%' once per
-- feed upload. No index can serve ILIKE, so it seq-scanned 4.1M rows (~340k blocks, 30-40 s).
-- Only ~9k rows match: a partial index on exactly that predicate makes the planner use it
-- (identical expression) and costs nothing on writes (providerKey is never updated on hot paths).
--
-- Prod: already created with CREATE INDEX CONCURRENTLY over a direct connection (no write lock),
-- so this statement is a no-op there. Not modelled in schema.prisma (partial).
CREATE INDEX IF NOT EXISTS "SupplierVariant_wel_providerKey_idx"
  ON "SupplierVariant" ("providerKey")
  WHERE "providerKey" ILIKE 'WEL\_%';
