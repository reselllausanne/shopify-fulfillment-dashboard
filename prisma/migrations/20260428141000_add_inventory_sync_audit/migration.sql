-- CreateTable
CREATE TABLE "public"."InventorySyncRun" (
    "id" TEXT NOT NULL,
    "jobKey" TEXT NOT NULL,
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "summaryJson" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventorySyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InventoryReconcileDrift" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "channel" "public"."MarketplaceChannel" NOT NULL,
    "providerKey" TEXT NOT NULL,
    "supplierVariantId" TEXT,
    "listingStock" INTEGER,
    "dbAvailableStock" INTEGER,
    "delta" INTEGER,
    "status" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryReconcileDrift_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventorySyncRun_jobKey_startedAt_idx" ON "public"."InventorySyncRun"("jobKey", "startedAt");

-- CreateIndex
CREATE INDEX "InventorySyncRun_status_idx" ON "public"."InventorySyncRun"("status");

-- CreateIndex
CREATE INDEX "InventoryReconcileDrift_runId_idx" ON "public"."InventoryReconcileDrift"("runId");

-- CreateIndex
CREATE INDEX "InventoryReconcileDrift_channel_providerKey_idx" ON "public"."InventoryReconcileDrift"("channel", "providerKey");

-- AddForeignKey
ALTER TABLE "public"."InventoryReconcileDrift" ADD CONSTRAINT "InventoryReconcileDrift_runId_fkey" FOREIGN KEY ("runId") REFERENCES "public"."InventorySyncRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
