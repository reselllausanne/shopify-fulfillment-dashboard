-- Warehouse module (Entrepôt) — lot 1.
--
-- ADDITIVE ONLY: 32 new "Warehouse*" tables, their indexes, constraints and guard triggers.
-- No existing table is altered, renamed or dropped. The only contact with existing tables is
-- four FOREIGN KEYs that REFERENCE "Partner"(id) (owner of a unit / batch / agreement / request).
--
-- Lock profile (see docs/warehouse/MIGRATION.md):
--   * CREATE TABLE / CREATE INDEX on brand-new empty tables: no lock on live tables.
--   * ADD CONSTRAINT ... REFERENCES "Partner": SHARE ROW EXCLUSIVE on "Partner" for the
--     duration of the statement only (13-row table, no scan of "Partner" needed because the
--     referencing tables are empty) — blocks writes to "Partner" for milliseconds, never reads.
--   * No trigger is created on any existing table. Nothing here is read by the feed / Shopify /
--     Galaxus / Decathlon jobs, so applying it cannot change a published quantity or price.
--
-- Old application versions ignore these tables entirely (compatible with the running code).

-- CreateTable
CREATE TABLE "WarehouseSite" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Zurich',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseSite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseLocation" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "parentId" TEXT,
    "code" TEXT NOT NULL,
    "shortCode" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "holdsUnits" BOOLEAN NOT NULL DEFAULT false,
    "sector" TEXT,
    "rowNo" INTEGER,
    "rackNo" INTEGER,
    "levelNo" INTEGER,
    "walkSequence" INTEGER NOT NULL DEFAULT 0,
    "capacity" INTEGER,
    "sizeProfile" TEXT NOT NULL DEFAULT 'STANDARD',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "statusReason" TEXT,
    "occupiedCount" INTEGER NOT NULL DEFAULT 0,
    "reservedCount" INTEGER NOT NULL DEFAULT 0,
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseLocationCode" (
    "code" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseLocationCode_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "WarehouseItem" (
    "id" TEXT NOT NULL,
    "gtin" TEXT,
    "brand" TEXT,
    "name" TEXT NOT NULL,
    "styleCode" TEXT,
    "colorway" TEXT,
    "sizeSystem" TEXT,
    "sizeLabel" TEXT,
    "sizeEu" TEXT,
    "sizeUs" TEXT,
    "imageUrl" TEXT,
    "kickdbVariantId" TEXT,
    "supplierVariantId" TEXT,
    "catalogSource" TEXT NOT NULL DEFAULT 'MANUAL',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "mergedIntoId" TEXT,
    "searchText" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseItemAlias" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseItemAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseOperator" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pinHash" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseOperator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseDepositAgreement" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "saleAllowed" BOOLEAN NOT NULL DEFAULT false,
    "channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pricingMode" TEXT NOT NULL DEFAULT 'MANUAL',
    "pricingFactor" DECIMAL(6,4),
    "pricingBasisIs" TEXT NOT NULL DEFAULT 'UNCONFIRMED',
    "commissionRate" DECIMAL(5,4),
    "fixedFee" DECIMAL(10,2),
    "currency" TEXT NOT NULL DEFAULT 'CHF',
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseDepositAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseBatch" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "flow" TEXT NOT NULL,
    "title" TEXT,
    "ownerKind" TEXT NOT NULL,
    "ownerPartnerId" TEXT,
    "agreementId" TEXT,
    "supplierName" TEXT,
    "sourceDocType" TEXT,
    "sourceDocRef" TEXT,
    "receivingLocationId" TEXT,
    "activeLocationId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "countedAt" TIMESTAMP(3),
    "expectedKnown" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdByOperatorId" TEXT,
    "closedAt" TIMESTAMP(3),
    "closeSummary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseBatchLine" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "itemId" TEXT,
    "gtin" TEXT,
    "description" TEXT,
    "sizeLabel" TEXT,
    "expectedQty" INTEGER,
    "receivedQty" INTEGER NOT NULL DEFAULT 0,
    "externalRef" TEXT,
    "importRowId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "closeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseBatchLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseBatchParcel" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "carrier" TEXT,
    "trackingNumber" TEXT,
    "externalRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'EXPECTED',
    "receivedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseBatchParcel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseCountSession" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "round" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "operatorId" TEXT,
    "stationId" TEXT,
    "countedUnits" INTEGER NOT NULL DEFAULT 0,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "WarehouseCountSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseCountScan" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "round" INTEGER NOT NULL DEFAULT 1,
    "result" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseCountScan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseUnit" (
    "id" TEXT NOT NULL,
    "labelCode" TEXT NOT NULL,
    "issuingSiteId" TEXT NOT NULL,
    "issuingSiteCode" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "ownerKind" TEXT NOT NULL,
    "ownerPartnerId" TEXT,
    "agreementId" TEXT,
    "originType" TEXT NOT NULL,
    "originBatchId" TEXT,
    "originLineId" TEXT,
    "presence" TEXT NOT NULL,
    "currentSiteId" TEXT,
    "currentLocationId" TEXT,
    "qcState" TEXT NOT NULL DEFAULT 'PENDING',
    "saleState" TEXT NOT NULL DEFAULT 'STORAGE_ONLY',
    "condition" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "boxCondition" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "conditionNote" TEXT,
    "outReason" TEXT,
    "outAt" TIMESTAMP(3),
    "labelVerifiedAt" TIMESTAMP(3),
    "labelPrintCount" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "historyArchivedAt" TIMESTAMP(3),
    "historyArchiveRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseLabelCode" (
    "code" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "isOriginal" BOOLEAN NOT NULL DEFAULT true,
    "issuingSiteCode" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "WarehouseLabelCode_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "WarehouseUnitExternalRef" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseUnitExternalRef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseLabelJournal" (
    "seq" BIGSERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exportedAt" TIMESTAMP(3),
    "exportSink" TEXT,
    "exportRef" TEXT,

    CONSTRAINT "WarehouseLabelJournal_pkey" PRIMARY KEY ("seq")
);

-- CreateTable
CREATE TABLE "WarehousePutawayTask" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "batchId" TEXT,
    "cartLocationId" TEXT,
    "fromLocationId" TEXT NOT NULL,
    "proposedLocationId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "holdReason" TEXT,
    "reservedAt" TIMESTAMP(3),
    "reservationExpiresAt" TIMESTAMP(3),
    "confirmedLocationId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "operatorId" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehousePutawayTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseMovement" (
    "id" TEXT NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "unitId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fromSiteId" TEXT,
    "fromLocationId" TEXT,
    "toSiteId" TEXT,
    "toLocationId" TEXT,
    "changes" JSONB,
    "reason" TEXT,
    "note" TEXT,
    "operatorId" TEXT,
    "actorRole" TEXT,
    "stationId" TEXT,
    "batchId" TEXT,
    "taskId" TEXT,
    "transferId" TEXT,
    "opKey" TEXT,
    "unitVersion" INTEGER NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseMovementArchive" (
    "id" TEXT NOT NULL,
    "seq" BIGINT NOT NULL,
    "unitId" TEXT NOT NULL,
    "archiveRef" TEXT NOT NULL,
    "row" JSONB NOT NULL,
    "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseMovementArchive_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseOperation" (
    "opKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "actorRole" TEXT,
    "operatorId" TEXT,
    "stationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseOperation_pkey" PRIMARY KEY ("opKey")
);

-- CreateTable
CREATE TABLE "WarehouseException" (
    "id" TEXT NOT NULL,
    "siteId" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "unitId" TEXT,
    "locationId" TEXT,
    "batchId" TEXT,
    "rawCode" TEXT,
    "details" JSONB,
    "resolution" TEXT,
    "resolutionReason" TEXT,
    "proofRef" TEXT,
    "createdByRole" TEXT,
    "createdByOperatorId" TEXT,
    "resolvedByOperatorId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "opKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseStation" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "tokenHash" TEXT,
    "pairedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseStation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehousePrinter" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "adapter" TEXT NOT NULL,
    "systemName" TEXT,
    "mediaWidthMm" DOUBLE PRECISION NOT NULL,
    "mediaHeightMm" DOUBLE PRECISION NOT NULL,
    "dpi" INTEGER,
    "orientation" TEXT NOT NULL DEFAULT 'landscape',
    "marginMm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "useDriverPaperSize" BOOLEAN NOT NULL DEFAULT false,
    "supportedKinds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "verifiedAt" TIMESTAMP(3),
    "verifiedNote" TEXT,
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehousePrinter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseStationRoute" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "labelKind" TEXT NOT NULL,
    "printerId" TEXT NOT NULL,
    "fallbackPrinterId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseStationRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehousePrintJob" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "printerId" TEXT,
    "labelKind" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "labelCode" TEXT,
    "payload" JSONB NOT NULL,
    "widthMm" DOUBLE PRECISION NOT NULL,
    "heightMm" DOUBLE PRECISION NOT NULL,
    "opKey" TEXT NOT NULL,
    "isReprint" BOOLEAN NOT NULL DEFAULT false,
    "reprintOfJobId" TEXT,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claimToken" TEXT,
    "claimedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "timeoutAt" TIMESTAMP(3),
    "lastError" TEXT,
    "requestedByOperatorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehousePrintJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseUnitPrice" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "agreementId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'CHF',
    "publicPrice" DECIMAL(10,2),
    "sellerNet" DECIMAL(10,2),
    "fees" DECIMAL(10,2),
    "margin" DECIMAL(10,2),
    "source" TEXT NOT NULL,
    "basisAmount" DECIMAL(10,2),
    "basisCurrency" TEXT,
    "basisRef" TEXT,
    "basisIncludesFees" BOOLEAN,
    "basisObservedAt" TIMESTAMP(3),
    "factor" DECIMAL(6,4),
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "note" TEXT,
    "setByRole" TEXT,
    "setByOperatorId" TEXT,
    "validatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseUnitPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehousePartnerRequest" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "unitId" TEXT,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "requestedPublicPrice" DECIMAL(10,2),
    "currency" TEXT NOT NULL DEFAULT 'CHF',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "response" TEXT,
    "answeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehousePartnerRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseTransfer" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "fromSiteId" TEXT NOT NULL,
    "toSiteId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "shippedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseTransferUnit" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_TRANSIT',
    "receivedAt" TIMESTAMP(3),
    "receivedLocationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseTransferUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseSaleAllocation" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "orderRef" TEXT NOT NULL,
    "lineRef" TEXT,
    "terms" JSONB,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "opKey" TEXT,
    "releasedAt" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseSaleAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseImport" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "targetId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PREVIEW',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "appliedRows" INTEGER NOT NULL DEFAULT 0,
    "errorRows" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseImportRow" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "raw" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "resultRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseSite_code_key" ON "WarehouseSite"("code");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseLocation_code_key" ON "WarehouseLocation"("code");

-- CreateIndex
CREATE INDEX "WarehouseLocation_siteId_holdsUnits_status_walkSequence_idx" ON "WarehouseLocation"("siteId", "holdsUnits", "status", "walkSequence");

-- CreateIndex
CREATE INDEX "WarehouseLocation_parentId_idx" ON "WarehouseLocation"("parentId");

-- CreateIndex
CREATE INDEX "WarehouseLocationCode_locationId_idx" ON "WarehouseLocationCode"("locationId");

-- CreateIndex
CREATE INDEX "WarehouseItem_gtin_idx" ON "WarehouseItem"("gtin");

-- CreateIndex
CREATE INDEX "WarehouseItem_styleCode_idx" ON "WarehouseItem"("styleCode");

-- CreateIndex
CREATE INDEX "WarehouseItemAlias_itemId_idx" ON "WarehouseItemAlias"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseItemAlias_namespace_value_key" ON "WarehouseItemAlias"("namespace", "value");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseOperator_code_key" ON "WarehouseOperator"("code");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseDepositAgreement_partnerId_version_key" ON "WarehouseDepositAgreement"("partnerId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseBatch_reference_key" ON "WarehouseBatch"("reference");

-- CreateIndex
CREATE INDEX "WarehouseBatch_siteId_status_createdAt_idx" ON "WarehouseBatch"("siteId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "WarehouseBatch_ownerPartnerId_idx" ON "WarehouseBatch"("ownerPartnerId");

-- CreateIndex
CREATE INDEX "WarehouseBatchLine_batchId_gtin_idx" ON "WarehouseBatchLine"("batchId", "gtin");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseBatchLine_batchId_lineNo_key" ON "WarehouseBatchLine"("batchId", "lineNo");

-- CreateIndex
CREATE INDEX "WarehouseBatchParcel_batchId_idx" ON "WarehouseBatchParcel"("batchId");

-- CreateIndex
CREATE INDEX "WarehouseBatchParcel_trackingNumber_idx" ON "WarehouseBatchParcel"("trackingNumber");

-- CreateIndex
CREATE INDEX "WarehouseCountSession_batchId_locationId_idx" ON "WarehouseCountSession"("batchId", "locationId");

-- CreateIndex
CREATE INDEX "WarehouseCountScan_batchId_unitId_idx" ON "WarehouseCountScan"("batchId", "unitId");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseCountScan_sessionId_unitId_key" ON "WarehouseCountScan"("sessionId", "unitId");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseUnit_labelCode_key" ON "WarehouseUnit"("labelCode");

-- CreateIndex
CREATE INDEX "WarehouseUnit_currentLocationId_idx" ON "WarehouseUnit"("currentLocationId");

-- CreateIndex
CREATE INDEX "WarehouseUnit_currentSiteId_presence_receivedAt_id_idx" ON "WarehouseUnit"("currentSiteId", "presence", "receivedAt", "id");

-- CreateIndex
CREATE INDEX "WarehouseUnit_ownerPartnerId_presence_itemId_idx" ON "WarehouseUnit"("ownerPartnerId", "presence", "itemId");

-- CreateIndex
CREATE INDEX "WarehouseUnit_ownerPartnerId_receivedAt_id_idx" ON "WarehouseUnit"("ownerPartnerId", "receivedAt", "id");

-- CreateIndex
CREATE INDEX "WarehouseUnit_itemId_presence_idx" ON "WarehouseUnit"("itemId", "presence");

-- CreateIndex
CREATE INDEX "WarehouseUnit_originBatchId_idx" ON "WarehouseUnit"("originBatchId");

-- CreateIndex
CREATE INDEX "WarehouseUnit_receivedAt_id_idx" ON "WarehouseUnit"("receivedAt", "id");

-- CreateIndex
CREATE INDEX "WarehouseLabelCode_unitId_idx" ON "WarehouseLabelCode"("unitId");

-- CreateIndex
CREATE INDEX "WarehouseUnitExternalRef_namespace_value_idx" ON "WarehouseUnitExternalRef"("namespace", "value");

-- CreateIndex
CREATE INDEX "WarehouseUnitExternalRef_unitId_idx" ON "WarehouseUnitExternalRef"("unitId");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseLabelJournal_code_key" ON "WarehouseLabelJournal"("code");

-- CreateIndex
CREATE INDEX "WarehouseLabelJournal_exportedAt_idx" ON "WarehouseLabelJournal"("exportedAt");

-- CreateIndex
CREATE INDEX "WarehousePutawayTask_siteId_status_createdAt_idx" ON "WarehousePutawayTask"("siteId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "WarehousePutawayTask_proposedLocationId_status_idx" ON "WarehousePutawayTask"("proposedLocationId", "status");

-- CreateIndex
CREATE INDEX "WarehousePutawayTask_batchId_status_idx" ON "WarehousePutawayTask"("batchId", "status");

-- CreateIndex
CREATE INDEX "WarehousePutawayTask_unitId_idx" ON "WarehousePutawayTask"("unitId");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseMovement_seq_key" ON "WarehouseMovement"("seq");

-- CreateIndex
CREATE INDEX "WarehouseMovement_unitId_seq_idx" ON "WarehouseMovement"("unitId", "seq");

-- CreateIndex
CREATE INDEX "WarehouseMovement_createdAt_idx" ON "WarehouseMovement"("createdAt");

-- CreateIndex
CREATE INDEX "WarehouseMovement_batchId_idx" ON "WarehouseMovement"("batchId");

-- CreateIndex
CREATE INDEX "WarehouseMovement_opKey_idx" ON "WarehouseMovement"("opKey");

-- CreateIndex
CREATE INDEX "WarehouseMovementArchive_unitId_seq_idx" ON "WarehouseMovementArchive"("unitId", "seq");

-- CreateIndex
CREATE INDEX "WarehouseMovementArchive_archiveRef_idx" ON "WarehouseMovementArchive"("archiveRef");

-- CreateIndex
CREATE INDEX "WarehouseOperation_createdAt_idx" ON "WarehouseOperation"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseException_opKey_key" ON "WarehouseException"("opKey");

-- CreateIndex
CREATE INDEX "WarehouseException_siteId_status_createdAt_idx" ON "WarehouseException"("siteId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "WarehouseException_unitId_idx" ON "WarehouseException"("unitId");

-- CreateIndex
CREATE INDEX "WarehouseException_batchId_idx" ON "WarehouseException"("batchId");

-- CreateIndex
CREATE INDEX "WarehouseException_type_status_idx" ON "WarehouseException"("type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseStation_code_key" ON "WarehouseStation"("code");

-- CreateIndex
CREATE INDEX "WarehouseStation_siteId_idx" ON "WarehouseStation"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "WarehousePrinter_siteId_name_key" ON "WarehousePrinter"("siteId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseStationRoute_stationId_labelKind_key" ON "WarehouseStationRoute"("stationId", "labelKind");

-- CreateIndex
CREATE UNIQUE INDEX "WarehousePrintJob_opKey_key" ON "WarehousePrintJob"("opKey");

-- CreateIndex
CREATE INDEX "WarehousePrintJob_stationId_status_createdAt_idx" ON "WarehousePrintJob"("stationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "WarehousePrintJob_objectType_objectId_idx" ON "WarehousePrintJob"("objectType", "objectId");

-- CreateIndex
CREATE INDEX "WarehousePrintJob_status_timeoutAt_idx" ON "WarehousePrintJob"("status", "timeoutAt");

-- CreateIndex
CREATE INDEX "WarehousePrintJob_siteId_createdAt_idx" ON "WarehousePrintJob"("siteId", "createdAt");

-- CreateIndex
CREATE INDEX "WarehouseUnitPrice_unitId_status_idx" ON "WarehouseUnitPrice"("unitId", "status");

-- CreateIndex
CREATE INDEX "WarehouseUnitPrice_status_createdAt_idx" ON "WarehouseUnitPrice"("status", "createdAt");

-- CreateIndex
CREATE INDEX "WarehousePartnerRequest_partnerId_status_createdAt_idx" ON "WarehousePartnerRequest"("partnerId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "WarehousePartnerRequest_status_createdAt_idx" ON "WarehousePartnerRequest"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseTransfer_reference_key" ON "WarehouseTransfer"("reference");

-- CreateIndex
CREATE INDEX "WarehouseTransfer_fromSiteId_status_idx" ON "WarehouseTransfer"("fromSiteId", "status");

-- CreateIndex
CREATE INDEX "WarehouseTransfer_toSiteId_status_idx" ON "WarehouseTransfer"("toSiteId", "status");

-- CreateIndex
CREATE INDEX "WarehouseTransferUnit_unitId_idx" ON "WarehouseTransferUnit"("unitId");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseTransferUnit_transferId_unitId_key" ON "WarehouseTransferUnit"("transferId", "unitId");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseSaleAllocation_opKey_key" ON "WarehouseSaleAllocation"("opKey");

-- CreateIndex
CREATE INDEX "WarehouseSaleAllocation_unitId_status_idx" ON "WarehouseSaleAllocation"("unitId", "status");

-- CreateIndex
CREATE INDEX "WarehouseSaleAllocation_channel_orderRef_idx" ON "WarehouseSaleAllocation"("channel", "orderRef");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseImport_kind_sha256_targetId_key" ON "WarehouseImport"("kind", "sha256", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseImportRow_importId_rowNumber_key" ON "WarehouseImportRow"("importId", "rowNumber");

-- AddForeignKey
ALTER TABLE "WarehouseLocation" ADD CONSTRAINT "WarehouseLocation_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "WarehouseSite"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseLocation" ADD CONSTRAINT "WarehouseLocation_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "WarehouseLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseLocationCode" ADD CONSTRAINT "WarehouseLocationCode_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "WarehouseLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseItemAlias" ADD CONSTRAINT "WarehouseItemAlias_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "WarehouseItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseDepositAgreement" ADD CONSTRAINT "WarehouseDepositAgreement_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseBatch" ADD CONSTRAINT "WarehouseBatch_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "WarehouseSite"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseBatch" ADD CONSTRAINT "WarehouseBatch_ownerPartnerId_fkey" FOREIGN KEY ("ownerPartnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseBatchLine" ADD CONSTRAINT "WarehouseBatchLine_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "WarehouseBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseBatchParcel" ADD CONSTRAINT "WarehouseBatchParcel_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "WarehouseBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseCountSession" ADD CONSTRAINT "WarehouseCountSession_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "WarehouseBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseCountSession" ADD CONSTRAINT "WarehouseCountSession_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "WarehouseLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseCountScan" ADD CONSTRAINT "WarehouseCountScan_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WarehouseCountSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseCountScan" ADD CONSTRAINT "WarehouseCountScan_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "WarehouseUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseUnit" ADD CONSTRAINT "WarehouseUnit_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "WarehouseItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseUnit" ADD CONSTRAINT "WarehouseUnit_ownerPartnerId_fkey" FOREIGN KEY ("ownerPartnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseUnit" ADD CONSTRAINT "WarehouseUnit_issuingSiteId_fkey" FOREIGN KEY ("issuingSiteId") REFERENCES "WarehouseSite"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseUnit" ADD CONSTRAINT "WarehouseUnit_currentSiteId_fkey" FOREIGN KEY ("currentSiteId") REFERENCES "WarehouseSite"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseUnit" ADD CONSTRAINT "WarehouseUnit_currentLocationId_fkey" FOREIGN KEY ("currentLocationId") REFERENCES "WarehouseLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseUnit" ADD CONSTRAINT "WarehouseUnit_originBatchId_fkey" FOREIGN KEY ("originBatchId") REFERENCES "WarehouseBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseLabelCode" ADD CONSTRAINT "WarehouseLabelCode_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "WarehouseUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseUnitExternalRef" ADD CONSTRAINT "WarehouseUnitExternalRef_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "WarehouseUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehousePutawayTask" ADD CONSTRAINT "WarehousePutawayTask_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "WarehouseUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehousePutawayTask" ADD CONSTRAINT "WarehousePutawayTask_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "WarehouseLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehousePutawayTask" ADD CONSTRAINT "WarehousePutawayTask_proposedLocationId_fkey" FOREIGN KEY ("proposedLocationId") REFERENCES "WarehouseLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseMovement" ADD CONSTRAINT "WarehouseMovement_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "WarehouseUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseStation" ADD CONSTRAINT "WarehouseStation_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "WarehouseSite"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehousePrinter" ADD CONSTRAINT "WarehousePrinter_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "WarehouseSite"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseStationRoute" ADD CONSTRAINT "WarehouseStationRoute_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "WarehouseStation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseStationRoute" ADD CONSTRAINT "WarehouseStationRoute_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "WarehousePrinter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseStationRoute" ADD CONSTRAINT "WarehouseStationRoute_fallbackPrinterId_fkey" FOREIGN KEY ("fallbackPrinterId") REFERENCES "WarehousePrinter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehousePrintJob" ADD CONSTRAINT "WarehousePrintJob_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "WarehouseStation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehousePrintJob" ADD CONSTRAINT "WarehousePrintJob_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "WarehousePrinter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseUnitPrice" ADD CONSTRAINT "WarehouseUnitPrice_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "WarehouseUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehousePartnerRequest" ADD CONSTRAINT "WarehousePartnerRequest_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseTransferUnit" ADD CONSTRAINT "WarehouseTransferUnit_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "WarehouseTransfer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseTransferUnit" ADD CONSTRAINT "WarehouseTransferUnit_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "WarehouseUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseSaleAllocation" ADD CONSTRAINT "WarehouseSaleAllocation_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "WarehouseUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseImportRow" ADD CONSTRAINT "WarehouseImportRow_importId_fkey" FOREIGN KEY ("importId") REFERENCES "WarehouseImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────────
-- Extras not expressible in the Prisma schema
-- ─────────────────────────────────────────────────────────────────────────────

-- State vocabularies (string columns + CHECK: additive to extend, unlike enums in use).
ALTER TABLE "WarehouseSite" ADD CONSTRAINT "WarehouseSite_status_check" CHECK ("status" IN ('ACTIVE','RETIRED'));
ALTER TABLE "WarehouseSite" ADD CONSTRAINT "WarehouseSite_code_check" CHECK ("code" ~ '^[A-Z]{2}[0-9]{2}$');

ALTER TABLE "WarehouseLocation" ADD CONSTRAINT "WarehouseLocation_kind_check"
  CHECK ("kind" IN ('SECTOR','ROW','RACK','LEVEL','RECEIVING','CART','PACKING','RETURNS','QUARANTINE'));
ALTER TABLE "WarehouseLocation" ADD CONSTRAINT "WarehouseLocation_status_check" CHECK ("status" IN ('ACTIVE','BLOCKED','RETIRED'));
ALTER TABLE "WarehouseLocation" ADD CONSTRAINT "WarehouseLocation_counts_check"
  CHECK ("occupiedCount" >= 0 AND "reservedCount" >= 0 AND ("capacity" IS NULL OR "capacity" >= 0));
ALTER TABLE "WarehouseLocation" ADD CONSTRAINT "WarehouseLocation_holds_check"
  CHECK ("holdsUnits" = ("kind" IN ('LEVEL','RECEIVING','CART','PACKING','RETURNS','QUARANTINE')));

ALTER TABLE "WarehouseItem" ADD CONSTRAINT "WarehouseItem_status_check" CHECK ("status" IN ('ACTIVE','PROVISIONAL','MERGED'));
ALTER TABLE "WarehouseItem" ADD CONSTRAINT "WarehouseItem_gtin_check" CHECK ("gtin" IS NULL OR "gtin" ~ '^[0-9]{8,14}$');

ALTER TABLE "WarehouseDepositAgreement" ADD CONSTRAINT "WarehouseDepositAgreement_status_check" CHECK ("status" IN ('DRAFT','ACTIVE','ENDED'));
ALTER TABLE "WarehouseDepositAgreement" ADD CONSTRAINT "WarehouseDepositAgreement_mode_check" CHECK ("pricingMode" IN ('MANUAL','STOCKX_BUYNOW_FACTOR'));
ALTER TABLE "WarehouseDepositAgreement" ADD CONSTRAINT "WarehouseDepositAgreement_basis_check" CHECK ("pricingBasisIs" IN ('PUBLIC_PRICE','SELLER_NET','UNCONFIRMED'));
CREATE UNIQUE INDEX "WarehouseDepositAgreement_one_active_per_partner" ON "WarehouseDepositAgreement" ("partnerId") WHERE "status" = 'ACTIVE';

ALTER TABLE "WarehouseBatch" ADD CONSTRAINT "WarehouseBatch_kind_check" CHECK ("kind" IN ('STOCK_TAKE','RECEIVING'));
ALTER TABLE "WarehouseBatch" ADD CONSTRAINT "WarehouseBatch_flow_check" CHECK ("flow" IN ('CONSIGNMENT','OWN_STOCK','SUPPLIER','ORDER_TRANSIT','CUSTOMER_RETURN'));
ALTER TABLE "WarehouseBatch" ADD CONSTRAINT "WarehouseBatch_status_check" CHECK ("status" IN ('OPEN','PAUSED','CLOSED','CANCELLED'));
ALTER TABLE "WarehouseBatch" ADD CONSTRAINT "WarehouseBatch_owner_check"
  CHECK ("ownerKind" IN ('OWN','PARTNER','UNKNOWN') AND (("ownerKind" = 'PARTNER') = ("ownerPartnerId" IS NOT NULL)));
ALTER TABLE "WarehouseBatchLine" ADD CONSTRAINT "WarehouseBatchLine_qty_check" CHECK ("receivedQty" >= 0 AND ("expectedQty" IS NULL OR "expectedQty" >= 0));
ALTER TABLE "WarehouseBatchParcel" ADD CONSTRAINT "WarehouseBatchParcel_status_check" CHECK ("status" IN ('EXPECTED','RECEIVED'));

ALTER TABLE "WarehouseCountSession" ADD CONSTRAINT "WarehouseCountSession_status_check" CHECK ("status" IN ('OPEN','CLOSED'));
-- A04: one open counting session per level, whoever opens it.
CREATE UNIQUE INDEX "WarehouseCountSession_one_open_per_location" ON "WarehouseCountSession" ("locationId") WHERE "status" = 'OPEN';
ALTER TABLE "WarehouseCountScan" ADD CONSTRAINT "WarehouseCountScan_result_check" CHECK ("result" IN ('CREATED','FOUND_HERE','MOVED_HERE'));

-- Unit identity + state dimensions.
ALTER TABLE "WarehouseUnit" ADD CONSTRAINT "WarehouseUnit_id_uuid_v4_check"
  CHECK ("id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');
ALTER TABLE "WarehouseUnit" ADD CONSTRAINT "WarehouseUnit_label_code_check" CHECK ("labelCode" = "id" || '-' || "issuingSiteCode");
ALTER TABLE "WarehouseUnit" ADD CONSTRAINT "WarehouseUnit_owner_check"
  CHECK ("ownerKind" IN ('OWN','PARTNER','UNKNOWN') AND (("ownerKind" = 'PARTNER') = ("ownerPartnerId" IS NOT NULL)));
ALTER TABLE "WarehouseUnit" ADD CONSTRAINT "WarehouseUnit_origin_check"
  CHECK ("originType" IN ('STOCK_TAKE','CONSIGNMENT','OWN_STOCK','SUPPLIER','ORDER_TRANSIT','CUSTOMER_RETURN','RECOVERED'));
ALTER TABLE "WarehouseUnit" ADD CONSTRAINT "WarehouseUnit_presence_check"
  CHECK ("presence" IN ('PRESENT','IN_TRANSIT','THIRD_PARTY','MISSING','OUT'));
-- One current logistics state: an address if and only if the unit is PRESENT.
ALTER TABLE "WarehouseUnit" ADD CONSTRAINT "WarehouseUnit_presence_location_check"
  CHECK (("presence" = 'PRESENT') = ("currentLocationId" IS NOT NULL)
     AND ("presence" <> 'PRESENT' OR "currentSiteId" IS NOT NULL)
     AND (("presence" = 'OUT') = ("outReason" IS NOT NULL)));
ALTER TABLE "WarehouseUnit" ADD CONSTRAINT "WarehouseUnit_qc_check" CHECK ("qcState" IN ('PENDING','PASSED','QUARANTINE'));
ALTER TABLE "WarehouseUnit" ADD CONSTRAINT "WarehouseUnit_sale_check" CHECK ("saleState" IN ('STORAGE_ONLY','SALE_AUTHORIZED','BLOCKED'));
ALTER TABLE "WarehouseUnit" ADD CONSTRAINT "WarehouseUnit_condition_check"
  CHECK ("condition" IN ('NEW','USED','DAMAGED','UNKNOWN') AND "boxCondition" IN ('GOOD','DAMAGED','MISSING','UNKNOWN'));
ALTER TABLE "WarehouseUnit" ADD CONSTRAINT "WarehouseUnit_out_reason_check"
  CHECK ("outReason" IS NULL OR "outReason" IN ('SOLD','WITHDRAWN','RETURNED_TO_SUPPLIER','DISPOSED','OTHER'));
-- Short-reference search (LIKE 'abcd%') on a non-C collation database.
CREATE INDEX "WarehouseUnit_id_prefix_idx" ON "WarehouseUnit" ("id" text_pattern_ops);
-- Partner portal: pairs still held by one owner, newest first. Pairs that left accumulate for
-- ever (measured: 800 000 out for 200 000 held); this keeps the portal on the held set only.
CREATE INDEX "WarehouseUnit_owner_held_idx" ON "WarehouseUnit" ("ownerPartnerId", "receivedAt" DESC, "id" DESC) WHERE "presence" <> 'OUT';

ALTER TABLE "WarehouseLabelCode" ADD CONSTRAINT "WarehouseLabelCode_format_check" CHECK ("format" IN ('UUID_SITE_V1','ALIAS'));
CREATE INDEX "WarehouseLabelJournal_pending_export_idx" ON "WarehouseLabelJournal" ("seq") WHERE "exportedAt" IS NULL;

ALTER TABLE "WarehousePutawayTask" ADD CONSTRAINT "WarehousePutawayTask_status_check" CHECK ("status" IN ('PENDING','RESERVED','DONE','CANCELLED'));
ALTER TABLE "WarehousePutawayTask" ADD CONSTRAINT "WarehousePutawayTask_reservation_check"
  CHECK (("status" = 'RESERVED') = ("proposedLocationId" IS NOT NULL AND "reservedAt" IS NOT NULL) OR "status" IN ('DONE','CANCELLED'));
-- One active putaway task per unit.
CREATE UNIQUE INDEX "WarehousePutawayTask_one_active_per_unit" ON "WarehousePutawayTask" ("unitId") WHERE "status" IN ('PENDING','RESERVED');
CREATE INDEX "WarehousePutawayTask_reservation_expiry_idx" ON "WarehousePutawayTask" ("reservationExpiresAt") WHERE "status" = 'RESERVED';

ALTER TABLE "WarehouseOperation" ADD CONSTRAINT "WarehouseOperation_status_check" CHECK ("status" IN ('DONE','REJECTED'));
ALTER TABLE "WarehouseException" ADD CONSTRAINT "WarehouseException_status_check" CHECK ("status" IN ('OPEN','RESOLVED','DISMISSED'));

ALTER TABLE "WarehouseStation" ADD CONSTRAINT "WarehouseStation_status_check" CHECK ("status" IN ('ACTIVE','DISABLED'));
ALTER TABLE "WarehousePrinter" ADD CONSTRAINT "WarehousePrinter_status_check" CHECK ("status" IN ('ACTIVE','DISABLED'));
ALTER TABLE "WarehousePrinter" ADD CONSTRAINT "WarehousePrinter_adapter_check" CHECK ("adapter" IN ('QZ_TRAY','PDF_MANUAL'));
ALTER TABLE "WarehousePrinter" ADD CONSTRAINT "WarehousePrinter_media_check" CHECK ("mediaWidthMm" > 0 AND "mediaHeightMm" > 0);
ALTER TABLE "WarehouseStationRoute" ADD CONSTRAINT "WarehouseStationRoute_kind_check" CHECK ("labelKind" IN ('PAIR','LOCATION','PARCEL','SHIPPING','RETURN'));
ALTER TABLE "WarehousePrintJob" ADD CONSTRAINT "WarehousePrintJob_status_check"
  CHECK ("status" IN ('QUEUED','CLAIMED','SENT','CONFIRMED','FAILED','UNCERTAIN','CANCELLED'));
ALTER TABLE "WarehousePrintJob" ADD CONSTRAINT "WarehousePrintJob_kind_check" CHECK ("labelKind" IN ('PAIR','LOCATION','TEST'));

ALTER TABLE "WarehouseUnitPrice" ADD CONSTRAINT "WarehouseUnitPrice_status_check" CHECK ("status" IN ('PROPOSED','VALIDATED','REJECTED','SUPERSEDED'));
ALTER TABLE "WarehouseUnitPrice" ADD CONSTRAINT "WarehouseUnitPrice_source_check" CHECK ("source" IN ('MANUAL','STOCKX_BUYNOW_FACTOR'));
ALTER TABLE "WarehouseUnitPrice" ADD CONSTRAINT "WarehouseUnitPrice_amounts_check"
  CHECK (("publicPrice" IS NULL OR "publicPrice" >= 0) AND ("sellerNet" IS NULL OR "sellerNet" >= 0));
-- One current validated price per unit; history stays.
CREATE UNIQUE INDEX "WarehouseUnitPrice_one_validated_per_unit" ON "WarehouseUnitPrice" ("unitId") WHERE "status" = 'VALIDATED';

ALTER TABLE "WarehousePartnerRequest" ADD CONSTRAINT "WarehousePartnerRequest_status_check" CHECK ("status" IN ('OPEN','ANSWERED','CLOSED'));
ALTER TABLE "WarehousePartnerRequest" ADD CONSTRAINT "WarehousePartnerRequest_type_check" CHECK ("type" IN ('PRICE_CHANGE','DISCREPANCY','OTHER'));

ALTER TABLE "WarehouseTransfer" ADD CONSTRAINT "WarehouseTransfer_status_check" CHECK ("status" IN ('OPEN','IN_TRANSIT','RECEIVED','PARTIAL','CLOSED'));
ALTER TABLE "WarehouseTransfer" ADD CONSTRAINT "WarehouseTransfer_sites_check" CHECK ("fromSiteId" <> "toSiteId");
ALTER TABLE "WarehouseTransferUnit" ADD CONSTRAINT "WarehouseTransferUnit_status_check" CHECK ("status" IN ('IN_TRANSIT','RECEIVED','MISSING'));
-- A unit can be in transit on one transfer only.
CREATE UNIQUE INDEX "WarehouseTransferUnit_one_in_transit_per_unit" ON "WarehouseTransferUnit" ("unitId") WHERE "status" = 'IN_TRANSIT';

ALTER TABLE "WarehouseSaleAllocation" ADD CONSTRAINT "WarehouseSaleAllocation_status_check" CHECK ("status" IN ('ACTIVE','RELEASED','SHIPPED'));
-- One active sale reservation per unit.
CREATE UNIQUE INDEX "WarehouseSaleAllocation_one_active_per_unit" ON "WarehouseSaleAllocation" ("unitId") WHERE "status" = 'ACTIVE';

ALTER TABLE "WarehouseImport" ADD CONSTRAINT "WarehouseImport_status_check" CHECK ("status" IN ('PREVIEW','APPLYING','APPLIED','PARTIAL'));
ALTER TABLE "WarehouseImportRow" ADD CONSTRAINT "WarehouseImportRow_status_check" CHECK ("status" IN ('PENDING','APPLIED','ERROR','SKIPPED'));

-- ─────────────────────────────────────────────────────────────────────────────
-- Identity guards (permanence of issued QR codes). Triggers live ONLY on new tables.
-- ─────────────────────────────────────────────────────────────────────────────

-- The scan registry is append-only: an issued value never changes unit and is never freed.
CREATE OR REPLACE FUNCTION "warehouse_label_code_immutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'WarehouseLabelCode is append-only (% on code %)', TG_OP, COALESCE(OLD."code", '?')
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;
CREATE TRIGGER "trg_warehouse_label_code_immutable"
  BEFORE UPDATE OR DELETE ON "WarehouseLabelCode"
  FOR EACH ROW EXECUTE FUNCTION "warehouse_label_code_immutable"();

CREATE OR REPLACE FUNCTION "warehouse_no_truncate"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% cannot be truncated (issued identities are permanent)', TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;
CREATE TRIGGER "trg_warehouse_label_code_no_truncate"
  BEFORE TRUNCATE ON "WarehouseLabelCode"
  FOR EACH STATEMENT EXECUTE FUNCTION "warehouse_no_truncate"();
CREATE TRIGGER "trg_warehouse_unit_no_truncate"
  BEFORE TRUNCATE ON "WarehouseUnit"
  FOR EACH STATEMENT EXECUTE FUNCTION "warehouse_no_truncate"();

-- A unit is never deleted and its identity columns never change.
CREATE OR REPLACE FUNCTION "warehouse_unit_identity_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'WarehouseUnit % cannot be deleted (archive it instead)', OLD."id"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."labelCode" IS DISTINCT FROM OLD."labelCode"
     OR NEW."issuingSiteId" IS DISTINCT FROM OLD."issuingSiteId"
     OR NEW."issuingSiteCode" IS DISTINCT FROM OLD."issuingSiteCode" THEN
    RAISE EXCEPTION 'WarehouseUnit % identity columns are immutable', OLD."id"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "trg_warehouse_unit_identity_guard"
  BEFORE UPDATE OR DELETE ON "WarehouseUnit"
  FOR EACH ROW EXECUTE FUNCTION "warehouse_unit_identity_guard"();

-- The movement journal is append-only. Rows leave it only through the archive routine,
-- which sets `warehouse.archiving = on` for its own transaction.
CREATE OR REPLACE FUNCTION "warehouse_movement_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('warehouse.archiving', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'WarehouseMovement is append-only (% on %)', TG_OP, OLD."id"
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;
CREATE TRIGGER "trg_warehouse_movement_append_only"
  BEFORE UPDATE OR DELETE ON "WarehouseMovement"
  FOR EACH ROW EXECUTE FUNCTION "warehouse_movement_append_only"();

-- Site codes are printed in QR labels: a site row keeps its code forever.
CREATE OR REPLACE FUNCTION "warehouse_site_code_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'WarehouseSite % cannot be deleted (retire it instead)', OLD."code"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW."code" IS DISTINCT FROM OLD."code" THEN
    RAISE EXCEPTION 'WarehouseSite code % is immutable', OLD."code"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "trg_warehouse_site_code_guard"
  BEFORE UPDATE OR DELETE ON "WarehouseSite"
  FOR EACH ROW EXECUTE FUNCTION "warehouse_site_code_guard"();

-- Location scan codes are never reassigned to another location nor removed.
CREATE OR REPLACE FUNCTION "warehouse_location_code_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'WarehouseLocationCode % cannot be deleted', OLD."code"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW."code" IS DISTINCT FROM OLD."code" OR NEW."locationId" IS DISTINCT FROM OLD."locationId" THEN
    RAISE EXCEPTION 'WarehouseLocationCode % cannot be reassigned', OLD."code"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "trg_warehouse_location_code_guard"
  BEFORE UPDATE OR DELETE ON "WarehouseLocationCode"
  FOR EACH ROW EXECUTE FUNCTION "warehouse_location_code_guard"();

-- ─────────────────────────────────────────────────────────────────────────────
-- Data API exposure: this project exposes `public` through PostgREST. Enable RLS with no
-- policy on every new table so the anon / authenticated API roles cannot read partner
-- stock. The application connects as the table owner (Prisma) and is not affected.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'WarehouseBatch',
    'WarehouseBatchLine',
    'WarehouseBatchParcel',
    'WarehouseCountScan',
    'WarehouseCountSession',
    'WarehouseDepositAgreement',
    'WarehouseException',
    'WarehouseImport',
    'WarehouseImportRow',
    'WarehouseItem',
    'WarehouseItemAlias',
    'WarehouseLabelCode',
    'WarehouseLabelJournal',
    'WarehouseLocation',
    'WarehouseLocationCode',
    'WarehouseMovement',
    'WarehouseMovementArchive',
    'WarehouseOperation',
    'WarehouseOperator',
    'WarehousePartnerRequest',
    'WarehousePrintJob',
    'WarehousePrinter',
    'WarehousePutawayTask',
    'WarehouseSaleAllocation',
    'WarehouseSite',
    'WarehouseStation',
    'WarehouseStationRoute',
    'WarehouseTransfer',
    'WarehouseTransferUnit',
    'WarehouseUnit',
    'WarehouseUnitExternalRef',
    'WarehouseUnitPrice'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
