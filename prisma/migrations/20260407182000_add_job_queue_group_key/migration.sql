ALTER TABLE "public"."GalaxusJobQueue"
  ADD COLUMN IF NOT EXISTS "groupKey" text,
  ADD COLUMN IF NOT EXISTS "resultJson" jsonb;

CREATE INDEX IF NOT EXISTS "GalaxusJobQueue_groupKey_idx"
  ON "public"."GalaxusJobQueue" ("groupKey");
