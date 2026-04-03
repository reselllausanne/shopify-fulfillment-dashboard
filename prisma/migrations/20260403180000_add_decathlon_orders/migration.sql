-- Decathlon marketplace orders + StockX / shipping / documents (schema was added without a migration).

-- DocumentType is shared with `Document`; create only if missing (e.g. legacy DBs that used `db push`).
DO $$ BEGIN
    CREATE TYPE "public"."DocumentType" AS ENUM ('INVOICE', 'DELIVERY_NOTE', 'LABEL');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE "public"."DecathlonOrder" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderNumber" TEXT,
    "orderDate" TIMESTAMP(3) NOT NULL,
    "orderState" TEXT,
    "currencyCode" TEXT NOT NULL DEFAULT 'CHF',
    "totalPrice" DECIMAL(10,2),
    "shippingPrice" DECIMAL(10,2),
    "customerName" TEXT,
    "customerEmail" TEXT,
    "customerPhone" TEXT,
    "customerAddress1" TEXT,
    "customerAddress2" TEXT,
    "customerPostalCode" TEXT,
    "customerCity" TEXT,
    "customerCountry" TEXT,
    "customerCountryCode" TEXT,
    "recipientName" TEXT,
    "recipientEmail" TEXT,
    "recipientPhone" TEXT,
    "recipientAddress1" TEXT,
    "recipientAddress2" TEXT,
    "recipientPostalCode" TEXT,
    "recipientCity" TEXT,
    "recipientCountry" TEXT,
    "recipientCountryCode" TEXT,
    "rawJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DecathlonOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DecathlonOrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "lineNumber" INTEGER,
    "offerSku" TEXT,
    "productSku" TEXT,
    "productTitle" TEXT,
    "description" TEXT,
    "size" TEXT,
    "gtin" TEXT,
    "providerKey" TEXT,
    "supplierSku" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2),
    "lineTotal" DECIMAL(10,2),
    "currencyCode" TEXT DEFAULT 'CHF',
    "rawJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DecathlonOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DecathlonShipment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "carrierRaw" TEXT,
    "carrierFinal" TEXT,
    "trackingNumber" TEXT,
    "shippedAt" TIMESTAMP(3),
    "labelGeneratedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DecathlonShipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DecathlonOrderDocument" (
    "id" TEXT NOT NULL,
    "orderId" TEXT,
    "shipmentId" TEXT,
    "type" "public"."DocumentType" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "storageUrl" TEXT NOT NULL,
    "checksum" TEXT,
    "miraklDocumentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecathlonOrderDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DecathlonStockxMatch" (
    "id" TEXT NOT NULL,
    "decathlonOrderId" TEXT NOT NULL,
    "decathlonOrderLineId" TEXT NOT NULL,
    "decathlonOrderDate" TIMESTAMP(3),
    "decathlonLineNumber" INTEGER,
    "decathlonProductName" TEXT,
    "decathlonDescription" TEXT,
    "decathlonSize" TEXT,
    "decathlonGtin" TEXT,
    "decathlonProviderKey" TEXT,
    "decathlonSupplierSku" TEXT,
    "decathlonQuantity" INTEGER NOT NULL,
    "decathlonUnitNetPrice" DECIMAL(10,2),
    "decathlonLineNetAmount" DECIMAL(10,2),
    "decathlonVatRate" DECIMAL(5,2),
    "decathlonCurrencyCode" TEXT DEFAULT 'CHF',
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

    CONSTRAINT "DecathlonStockxMatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DecathlonOrder_orderId_key" ON "public"."DecathlonOrder"("orderId");

-- CreateIndex
CREATE INDEX "DecathlonOrder_orderDate_idx" ON "public"."DecathlonOrder"("orderDate");

-- CreateIndex
CREATE INDEX "DecathlonOrder_orderState_idx" ON "public"."DecathlonOrder"("orderState");

-- CreateIndex
CREATE UNIQUE INDEX "DecathlonOrderLine_orderLineId_key" ON "public"."DecathlonOrderLine"("orderLineId");

-- CreateIndex
CREATE INDEX "DecathlonOrderLine_orderId_idx" ON "public"."DecathlonOrderLine"("orderId");

-- CreateIndex
CREATE INDEX "DecathlonOrderLine_offerSku_idx" ON "public"."DecathlonOrderLine"("offerSku");

-- CreateIndex
CREATE INDEX "DecathlonShipment_orderId_idx" ON "public"."DecathlonShipment"("orderId");

-- CreateIndex
CREATE INDEX "DecathlonOrderDocument_orderId_idx" ON "public"."DecathlonOrderDocument"("orderId");

-- CreateIndex
CREATE INDEX "DecathlonOrderDocument_shipmentId_idx" ON "public"."DecathlonOrderDocument"("shipmentId");

-- CreateIndex
CREATE UNIQUE INDEX "DecathlonStockxMatch_decathlonOrderLineId_key" ON "public"."DecathlonStockxMatch"("decathlonOrderLineId");

-- CreateIndex
CREATE INDEX "DecathlonStockxMatch_decathlonOrderId_idx" ON "public"."DecathlonStockxMatch"("decathlonOrderId");

-- CreateIndex
CREATE INDEX "DecathlonStockxMatch_stockxOrderNumber_idx" ON "public"."DecathlonStockxMatch"("stockxOrderNumber");

-- CreateIndex
CREATE INDEX "DecathlonStockxMatch_stockxVariantId_idx" ON "public"."DecathlonStockxMatch"("stockxVariantId");

-- AddForeignKey
ALTER TABLE "public"."DecathlonOrderLine" ADD CONSTRAINT "DecathlonOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."DecathlonOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DecathlonShipment" ADD CONSTRAINT "DecathlonShipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."DecathlonOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DecathlonOrderDocument" ADD CONSTRAINT "DecathlonOrderDocument_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."DecathlonOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DecathlonOrderDocument" ADD CONSTRAINT "DecathlonOrderDocument_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "public"."DecathlonShipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DecathlonStockxMatch" ADD CONSTRAINT "DecathlonStockxMatch_decathlonOrderId_fkey" FOREIGN KEY ("decathlonOrderId") REFERENCES "public"."DecathlonOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DecathlonStockxMatch" ADD CONSTRAINT "DecathlonStockxMatch_decathlonOrderLineId_fkey" FOREIGN KEY ("decathlonOrderLineId") REFERENCES "public"."DecathlonOrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
