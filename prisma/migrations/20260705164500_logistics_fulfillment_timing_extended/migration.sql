ALTER TABLE "public"."ShopifyFulfillmentRecord"
ADD COLUMN IF NOT EXISTS "requestStartedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "requestCompletedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "requestDurationMs" INTEGER,
ADD COLUMN IF NOT EXISTS "scanToLabelSeconds" INTEGER,
ADD COLUMN IF NOT EXISTS "scanToFulfillmentSeconds" INTEGER,
ADD COLUMN IF NOT EXISTS "stockxDeliveredToScanMinutes" INTEGER,
ADD COLUMN IF NOT EXISTS "stockxDeliveredToFulfillmentMinutes" INTEGER;

CREATE INDEX IF NOT EXISTS "ShopifyFulfillmentRecord_requestStartedAt_idx"
ON "public"."ShopifyFulfillmentRecord"("requestStartedAt");
