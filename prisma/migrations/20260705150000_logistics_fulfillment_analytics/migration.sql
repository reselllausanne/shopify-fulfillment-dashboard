ALTER TABLE "public"."ShopifyFulfillmentRecord"
ADD COLUMN IF NOT EXISTS "actorRole" TEXT,
ADD COLUMN IF NOT EXISTS "scanSessionKey" TEXT,
ADD COLUMN IF NOT EXISTS "scanStartedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "scanCompletedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "labelGeneratedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "stockxDeliveredAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "stockxDeliveredMilestoneKey" TEXT,
ADD COLUMN IF NOT EXISTS "stockxDeliveredLagMinutes" INTEGER;

CREATE INDEX IF NOT EXISTS "ShopifyFulfillmentRecord_scanSessionKey_idx"
ON "public"."ShopifyFulfillmentRecord"("scanSessionKey");

CREATE INDEX IF NOT EXISTS "ShopifyFulfillmentRecord_labelGeneratedAt_idx"
ON "public"."ShopifyFulfillmentRecord"("labelGeneratedAt");

CREATE INDEX IF NOT EXISTS "ShopifyFulfillmentRecord_stockxDeliveredAt_idx"
ON "public"."ShopifyFulfillmentRecord"("stockxDeliveredAt");
