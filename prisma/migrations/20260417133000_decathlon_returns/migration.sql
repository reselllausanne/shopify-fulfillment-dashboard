-- Decathlon returns + lines (closed return tracking).

-- CreateTable
CREATE TABLE "public"."DecathlonReturn" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "orderId" TEXT,
    "status" TEXT,
    "rawJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DecathlonReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DecathlonReturnLine" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "orderLineId" TEXT,
    "offerSku" TEXT,
    "productId" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2),
    "returnPrice" DECIMAL(10,2),
    "currencyCode" TEXT DEFAULT 'CHF',
    "restockAppliedAt" TIMESTAMP(3),
    "restockSupplierVariantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DecathlonReturnLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DecathlonReturn_returnId_key" ON "public"."DecathlonReturn"("returnId");

-- CreateIndex
CREATE INDEX "DecathlonReturn_orderId_idx" ON "public"."DecathlonReturn"("orderId");

-- CreateIndex
CREATE INDEX "DecathlonReturn_status_idx" ON "public"."DecathlonReturn"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DecathlonReturnLine_returnId_orderLineId_productId_key"
ON "public"."DecathlonReturnLine"("returnId", "orderLineId", "productId");

-- CreateIndex
CREATE INDEX "DecathlonReturnLine_returnId_idx" ON "public"."DecathlonReturnLine"("returnId");

-- CreateIndex
CREATE INDEX "DecathlonReturnLine_orderLineId_idx" ON "public"."DecathlonReturnLine"("orderLineId");

-- CreateIndex
CREATE INDEX "DecathlonReturnLine_offerSku_idx" ON "public"."DecathlonReturnLine"("offerSku");

-- AddForeignKey
ALTER TABLE "public"."DecathlonReturn"
ADD CONSTRAINT "DecathlonReturn_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "public"."DecathlonOrder"("orderId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DecathlonReturnLine"
ADD CONSTRAINT "DecathlonReturnLine_returnId_fkey"
FOREIGN KEY ("returnId") REFERENCES "public"."DecathlonReturn"("returnId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DecathlonReturnLine"
ADD CONSTRAINT "DecathlonReturnLine_orderLineId_fkey"
FOREIGN KEY ("orderLineId") REFERENCES "public"."DecathlonOrderLine"("orderLineId") ON DELETE SET NULL ON UPDATE CASCADE;
