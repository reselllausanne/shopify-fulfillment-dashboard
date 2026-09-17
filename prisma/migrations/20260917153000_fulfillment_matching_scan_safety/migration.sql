-- StockX inbound packages for AWB→Shopify fallback (last ~100 retained in app).
-- Multi-account ready via stockxAccountKey.

CREATE TABLE IF NOT EXISTS "StockxInboundPackage" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "awb" TEXT NOT NULL,
    "stockxOrderNumber" TEXT,
    "stockxOrderId" TEXT,
    "stockxAccountKey" TEXT NOT NULL DEFAULT 'default',
    "sku" TEXT,
    "sizeEU" TEXT,
    "productName" TEXT,
    "purchaseDate" TIMESTAMP(3),
    "status" TEXT,
    "arrivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "channelHint" TEXT,
    "linkedShopifyLineItemId" TEXT,
    "linkedGalaxusOrderId" TEXT,

    CONSTRAINT "StockxInboundPackage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "StockxInboundPackage_awb_key" ON "StockxInboundPackage"("awb");
CREATE INDEX IF NOT EXISTS "StockxInboundPackage_arrivedAt_idx" ON "StockxInboundPackage"("arrivedAt");
CREATE INDEX IF NOT EXISTS "StockxInboundPackage_sku_sizeEU_idx" ON "StockxInboundPackage"("sku", "sizeEU");
CREATE INDEX IF NOT EXISTS "StockxInboundPackage_stockxAccountKey_arrivedAt_idx" ON "StockxInboundPackage"("stockxAccountKey", "arrivedAt");
CREATE INDEX IF NOT EXISTS "StockxInboundPackage_purchaseDate_idx" ON "StockxInboundPackage"("purchaseDate");

-- Speed StockX↔Galaxus candidate filtering (open / partial orders).
CREATE INDEX IF NOT EXISTS "GalaxusOrder_deliveryType_cancelledAt_archivedAt_idx"
  ON "GalaxusOrder"("deliveryType", "cancelledAt", "archivedAt");

CREATE INDEX IF NOT EXISTS "GalaxusOrderLine_orderId_warehouseMarkedShippedAt_idx"
  ON "GalaxusOrderLine"("orderId", "warehouseMarkedShippedAt");

CREATE INDEX IF NOT EXISTS "OrderMatch_shopifySku_shopifySizeEU_shopifyCreatedAt_idx"
  ON "OrderMatch"("shopifySku", "shopifySizeEU", "shopifyCreatedAt");

CREATE INDEX IF NOT EXISTS "OrderMatch_stockxAwb_idx"
  ON "OrderMatch"("stockxAwb");
