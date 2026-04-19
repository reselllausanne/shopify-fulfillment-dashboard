-- CreateTable
CREATE TABLE "public"."GalaxusStockxMatch" (
    "id" TEXT NOT NULL,
    "galaxusOrderId" TEXT NOT NULL,
    "galaxusOrderRef" TEXT,
    "galaxusOrderDate" TIMESTAMP(3),
    "galaxusOrderLineId" TEXT NOT NULL,
    "galaxusLineNumber" INTEGER,
    "galaxusProductName" TEXT NOT NULL,
    "galaxusDescription" TEXT,
    "galaxusSize" TEXT,
    "galaxusGtin" TEXT,
    "galaxusProviderKey" TEXT,
    "galaxusSupplierSku" TEXT,
    "galaxusQuantity" INTEGER NOT NULL,
    "galaxusUnitNetPrice" DECIMAL(10,2) NOT NULL,
    "galaxusLineNetAmount" DECIMAL(10,2) NOT NULL,
    "galaxusVatRate" DECIMAL(5,2) NOT NULL,
    "galaxusCurrencyCode" TEXT NOT NULL DEFAULT 'CHF',
    "stockxChainId" TEXT,
    "stockxOrderId" TEXT,
    "stockxOrderNumber" TEXT NOT NULL,
    "stockxVariantId" TEXT,
    "stockxProductName" TEXT,
    "stockxSkuKey" TEXT,
    "stockxSizeEU" TEXT,
    "stockxPurchaseDate" TIMESTAMP(3),
    "stockxAmount" DECIMAL(10,2),
    "stockxCurrencyCode" TEXT,
    "stockxStatus" TEXT,
    "stockxEstimatedDelivery" TIMESTAMP(3),
    "stockxLatestEstimatedDelivery" TIMESTAMP(3),
    "stockxAwb" TEXT,
    "stockxTrackingUrl" TEXT,
    "stockxCheckoutType" TEXT,
    "stockxStates" JSONB,
    "matchConfidence" TEXT,
    "matchScore" DECIMAL(5,2),
    "matchType" TEXT,
    "matchReasons" TEXT,
    "timeDiffHours" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GalaxusStockxMatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GalaxusStockxMatch_galaxusOrderLineId_key" ON "public"."GalaxusStockxMatch"("galaxusOrderLineId");

-- CreateIndex
CREATE INDEX "GalaxusStockxMatch_galaxusOrderId_idx" ON "public"."GalaxusStockxMatch"("galaxusOrderId");

-- CreateIndex
CREATE INDEX "GalaxusStockxMatch_stockxOrderNumber_idx" ON "public"."GalaxusStockxMatch"("stockxOrderNumber");

-- CreateIndex
CREATE INDEX "GalaxusStockxMatch_stockxVariantId_idx" ON "public"."GalaxusStockxMatch"("stockxVariantId");

-- AddForeignKey
ALTER TABLE "public"."GalaxusStockxMatch"
ADD CONSTRAINT "GalaxusStockxMatch_galaxusOrderId_fkey"
FOREIGN KEY ("galaxusOrderId") REFERENCES "public"."GalaxusOrder"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GalaxusStockxMatch"
ADD CONSTRAINT "GalaxusStockxMatch_galaxusOrderLineId_fkey"
FOREIGN KEY ("galaxusOrderLineId") REFERENCES "public"."GalaxusOrderLine"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
