-- Persist StockX buy settled amount / order # on link (for Galaxus margin vs line net).
ALTER TABLE "public"."StxPurchaseUnit" ADD COLUMN IF NOT EXISTS "stockxOrderNumber" TEXT;
ALTER TABLE "public"."StxPurchaseUnit" ADD COLUMN IF NOT EXISTS "stockxSettledAmount" DECIMAL(12,2);
ALTER TABLE "public"."StxPurchaseUnit" ADD COLUMN IF NOT EXISTS "stockxSettledCurrency" TEXT;
