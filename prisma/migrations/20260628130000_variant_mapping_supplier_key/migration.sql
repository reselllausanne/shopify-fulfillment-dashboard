ALTER TABLE "public"."VariantMapping" ADD COLUMN IF NOT EXISTS "supplierKey" TEXT;

CREATE INDEX IF NOT EXISTS "VariantMapping_supplierKey_status_idx"
  ON "public"."VariantMapping" ("supplierKey", "status");
