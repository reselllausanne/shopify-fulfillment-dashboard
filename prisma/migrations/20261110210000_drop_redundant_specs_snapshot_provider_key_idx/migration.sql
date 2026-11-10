-- GalaxusFeedSpecsSnapshot_providerKey_idx is redundant with the primary key
-- (providerKey, specificationKey): 193 MB, 0 scans, 50M writes (full snapshot rewrites).
-- Prod already dropped it with DROP INDEX CONCURRENTLY; this keeps fresh databases in sync.
-- IF EXISTS makes it a no-op where the index is already gone.
DROP INDEX IF EXISTS "public"."GalaxusFeedSpecsSnapshot_providerKey_idx";
