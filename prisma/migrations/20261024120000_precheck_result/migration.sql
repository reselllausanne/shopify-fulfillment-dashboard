-- DB-only StockX pre-check verdict per Shopify order line. Additive only.

CREATE TABLE IF NOT EXISTS "public"."PrecheckResult" (
  "id" TEXT NOT NULL,
  "shopifyOrderName" TEXT NOT NULL,
  "shopifyLineItemId" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL,
  "reason" TEXT,
  "lane" TEXT,
  "expectedBuyChf" DECIMAL(10,2),
  "sellChf" DECIMAL(10,2),
  "marginPct" DECIMAL(6,4),
  "stock" INTEGER,
  "supplierVariantId" TEXT,
  "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PrecheckResult_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PrecheckResult_shopifyOrderName_shopifyLineItemId_key"
  ON "public"."PrecheckResult" ("shopifyOrderName", "shopifyLineItemId");

CREATE INDEX IF NOT EXISTS "PrecheckResult_status_idx"
  ON "public"."PrecheckResult" ("status");

CREATE INDEX IF NOT EXISTS "PrecheckResult_checkedAt_idx"
  ON "public"."PrecheckResult" ("checkedAt");
