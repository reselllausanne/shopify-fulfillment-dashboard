-- CreateTable
CREATE TABLE "marketplace_returns" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'decathlon',
    "externalReturnId" TEXT NOT NULL,
    "externalOrderId" TEXT NOT NULL,
    "externalOrderLineId" TEXT,
    "productId" TEXT,
    "productTitle" TEXT,
    "sku" TEXT,
    "returnLabelNumber" TEXT,
    "returnAmount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CHF',
    "returnReasonCode" TEXT,
    "returnReasonLabel" TEXT,
    "miraklStatus" TEXT,
    "localStatus" TEXT NOT NULL DEFAULT 'pending_receipt',
    "processStep" TEXT NOT NULL DEFAULT 'pending',
    "syncedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failureMessage" TEXT,
    "staffNote" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "apiSource" TEXT,
    "receiveActionId" TEXT,
    "refundIdsJson" JSONB,
    "closeActionId" TEXT,
    "auditLogJson" JSONB,
    "rawJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_return_sync_cursors" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "lastSuccessfulSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_return_sync_cursors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_returns_platform_externalReturnId_key" ON "marketplace_returns"("platform", "externalReturnId");

-- CreateIndex
CREATE INDEX "marketplace_returns_platform_returnLabelNumber_idx" ON "marketplace_returns"("platform", "returnLabelNumber");

-- CreateIndex
CREATE INDEX "marketplace_returns_localStatus_idx" ON "marketplace_returns"("localStatus");

-- CreateIndex
CREATE INDEX "marketplace_returns_externalOrderId_idx" ON "marketplace_returns"("externalOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_return_sync_cursors_platform_key" ON "marketplace_return_sync_cursors"("platform");
