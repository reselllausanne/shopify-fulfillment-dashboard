-- CreateTable
CREATE TABLE "SupplierOrderTracking" (
    "id" TEXT NOT NULL,
    "chainId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "trackingUrl" TEXT,
    "returnTrackingUrl" TEXT,
    "deliveryDate" TIMESTAMP(3),
    "statusKey" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierOrderTracking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierOrderTracking_orderNumber_idx" ON "SupplierOrderTracking"("orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierOrderTracking_chainId_orderNumber_key" ON "SupplierOrderTracking"("chainId", "orderNumber");
