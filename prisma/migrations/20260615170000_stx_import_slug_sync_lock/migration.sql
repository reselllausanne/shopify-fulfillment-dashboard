-- Safe parallel STX slug sync claims (FOR UPDATE SKIP LOCKED helpers)
ALTER TABLE "public"."StxImportSlug"
  ADD COLUMN IF NOT EXISTS "syncLockedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "syncLockedBy" TEXT;

CREATE INDEX IF NOT EXISTS "StxImportSlug_status_syncLockedAt_createdAt_idx"
  ON "public"."StxImportSlug" ("status", "syncLockedAt", "createdAt");
