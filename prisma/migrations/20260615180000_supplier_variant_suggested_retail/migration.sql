ALTER TABLE "public"."SupplierVariant"
  ADD COLUMN IF NOT EXISTS "suggestedRetailPriceInclVat" DECIMAL(10, 2);
