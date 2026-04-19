-- CreateTable
CREATE TABLE "public"."StxPurchaseUnit" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "galaxusOrderId" TEXT NOT NULL,
    "gtin" TEXT NOT NULL,
    "supplierVariantId" TEXT NOT NULL,
    "stockxOrderId" TEXT,
    "awb" TEXT,
    "etaMin" TIMESTAMP(3),
    "etaMax" TIMESTAMP(3),
    "checkoutType" TEXT,
    CONSTRAINT "StxPurchaseUnit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StxPurchaseUnit_stockxOrderId_key" ON "public"."StxPurchaseUnit"("stockxOrderId");

-- CreateIndex
CREATE INDEX "StxPurchaseUnit_galaxusOrderId_idx" ON "public"."StxPurchaseUnit"("galaxusOrderId");

-- CreateIndex
CREATE INDEX "StxPurchaseUnit_gtin_idx" ON "public"."StxPurchaseUnit"("gtin");

-- CreateIndex
CREATE INDEX "StxPurchaseUnit_supplierVariantId_idx" ON "public"."StxPurchaseUnit"("supplierVariantId");

-- CreateIndex
CREATE INDEX "StxPurchaseUnit_awb_idx" ON "public"."StxPurchaseUnit"("awb");
