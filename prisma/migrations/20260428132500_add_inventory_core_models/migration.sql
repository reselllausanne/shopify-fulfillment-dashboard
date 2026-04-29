-- CreateEnum
CREATE TYPE "public"."InventoryEventType" AS ENUM ('SALE', 'RETURN', 'ADJUSTMENT', 'RESERVATION', 'RELEASE');

-- CreateTable
CREATE TABLE "public"."InventoryEvent" (
    "id" TEXT NOT NULL,
    "eventType" "public"."InventoryEventType" NOT NULL DEFAULT 'SALE',
    "channel" "public"."MarketplaceChannel" NOT NULL,
    "externalOrderId" TEXT,
    "externalLineId" TEXT,
    "supplierVariantId" TEXT NOT NULL,
    "providerKey" TEXT,
    "quantityDelta" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,
    "payloadJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ChannelListingState" (
    "id" TEXT NOT NULL,
    "channel" "public"."MarketplaceChannel" NOT NULL,
    "providerKey" TEXT NOT NULL,
    "supplierVariantId" TEXT,
    "gtin" TEXT,
    "externalProductId" TEXT,
    "externalVariantId" TEXT,
    "externalInventoryItemId" TEXT,
    "externalLocationId" TEXT,
    "lastPushedStock" INTEGER,
    "lastPushedPrice" DECIMAL(10,2),
    "lastSyncedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "lastError" TEXT,
    "soldOutAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelListingState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OrderLineSyncState" (
    "id" TEXT NOT NULL,
    "channel" "public"."MarketplaceChannel" NOT NULL,
    "externalOrderId" TEXT,
    "externalLineId" TEXT NOT NULL,
    "supplierVariantId" TEXT NOT NULL,
    "providerKey" TEXT,
    "quantity" INTEGER NOT NULL,
    "eventType" "public"."InventoryEventType" NOT NULL DEFAULT 'SALE',
    "eventId" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payloadJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderLineSyncState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InventoryEvent_idempotencyKey_key" ON "public"."InventoryEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "InventoryEvent_supplierVariantId_occurredAt_idx" ON "public"."InventoryEvent"("supplierVariantId", "occurredAt");

-- CreateIndex
CREATE INDEX "InventoryEvent_channel_externalOrderId_idx" ON "public"."InventoryEvent"("channel", "externalOrderId");

-- CreateIndex
CREATE INDEX "InventoryEvent_channel_externalLineId_idx" ON "public"."InventoryEvent"("channel", "externalLineId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelListingState_channel_providerKey_key" ON "public"."ChannelListingState"("channel", "providerKey");

-- CreateIndex
CREATE INDEX "ChannelListingState_supplierVariantId_idx" ON "public"."ChannelListingState"("supplierVariantId");

-- CreateIndex
CREATE INDEX "ChannelListingState_channel_status_idx" ON "public"."ChannelListingState"("channel", "status");

-- CreateIndex
CREATE INDEX "ChannelListingState_externalVariantId_idx" ON "public"."ChannelListingState"("externalVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderLineSyncState_channel_externalLineId_key" ON "public"."OrderLineSyncState"("channel", "externalLineId");

-- CreateIndex
CREATE INDEX "OrderLineSyncState_supplierVariantId_channel_idx" ON "public"."OrderLineSyncState"("supplierVariantId", "channel");

-- CreateIndex
CREATE INDEX "OrderLineSyncState_externalOrderId_idx" ON "public"."OrderLineSyncState"("externalOrderId");

-- AddForeignKey
ALTER TABLE "public"."InventoryEvent" ADD CONSTRAINT "InventoryEvent_supplierVariantId_fkey" FOREIGN KEY ("supplierVariantId") REFERENCES "public"."SupplierVariant"("supplierVariantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ChannelListingState" ADD CONSTRAINT "ChannelListingState_supplierVariantId_fkey" FOREIGN KEY ("supplierVariantId") REFERENCES "public"."SupplierVariant"("supplierVariantId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrderLineSyncState" ADD CONSTRAINT "OrderLineSyncState_supplierVariantId_fkey" FOREIGN KEY ("supplierVariantId") REFERENCES "public"."SupplierVariant"("supplierVariantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrderLineSyncState" ADD CONSTRAINT "OrderLineSyncState_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "public"."InventoryEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
