-- Post-sale idempotency: mark each paid Shopify order line once processed.
CREATE TABLE IF NOT EXISTS "public"."ShopifyPaidLineState" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "lineItemId" TEXT NOT NULL,
    "gtin" TEXT,
    "variantId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "ok" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopifyPaidLineState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ShopifyPaidLineState_orderId_lineItemId_key"
    ON "public"."ShopifyPaidLineState"("orderId", "lineItemId");

CREATE INDEX IF NOT EXISTS "ShopifyPaidLineState_processedAt_idx"
    ON "public"."ShopifyPaidLineState"("processedAt");

CREATE INDEX IF NOT EXISTS "ShopifyPaidLineState_gtin_idx"
    ON "public"."ShopifyPaidLineState"("gtin");
