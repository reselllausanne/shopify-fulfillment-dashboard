-- Manual override fields for StockX purchase units (Galaxus flow)
ALTER TABLE "public"."StxPurchaseUnit"
ADD COLUMN IF NOT EXISTS "manualTrackingRaw" TEXT,
ADD COLUMN IF NOT EXISTS "manualNote" TEXT,
ADD COLUMN IF NOT EXISTS "manualSetAt" TIMESTAMP(3);

