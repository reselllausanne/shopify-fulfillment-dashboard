-- Return labels: store on Supabase (private bucket) + queryable columns.
-- Additive, nullable. Safe on prod (existing rows get NULL, new rows get the label key + s3 URL).

ALTER TABLE "public"."marketplace_returns"
  ADD COLUMN IF NOT EXISTS "labelKey"        TEXT,
  ADD COLUMN IF NOT EXISTS "labelStorageUrl" TEXT;

CREATE INDEX IF NOT EXISTS "marketplace_returns_labelKey_idx"
  ON "public"."marketplace_returns" ("labelKey");
