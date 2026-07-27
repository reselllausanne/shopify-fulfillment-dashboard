ALTER TABLE "public"."SupplierVariant"
  ADD COLUMN IF NOT EXISTS "standardBuyPrice" DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS "expressBuyPrice" DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS "standardSuggestedRetailPriceInclVat" DECIMAL(10, 2);
