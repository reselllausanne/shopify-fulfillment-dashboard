-- CreateEnum
CREATE TYPE "public"."DecathlonImportFlow" AS ENUM ('OF01', 'STO01', 'PRI01');

-- CreateEnum
CREATE TYPE "public"."DecathlonImportMode" AS ENUM ('NORMAL', 'REPLACE', 'TEST');

-- CreateEnum
CREATE TYPE "public"."DecathlonImportStatus" AS ENUM ('CREATED', 'RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');

-- CreateTable
CREATE TABLE "public"."DecathlonOfferSync" (
    "id" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "supplierVariantId" TEXT,
    "gtin" TEXT,
    "lastStock" INTEGER,
    "lastPrice" DECIMAL(10,2),
    "lastStockSyncedAt" TIMESTAMP(3),
    "lastPriceSyncedAt" TIMESTAMP(3),
    "offerCreatedAt" TIMESTAMP(3),
    "lastOfferSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DecathlonOfferSync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DecathlonImportRun" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "flow" "public"."DecathlonImportFlow" NOT NULL,
    "mode" "public"."DecathlonImportMode" NOT NULL,
    "status" "public"."DecathlonImportStatus" NOT NULL DEFAULT 'CREATED',
    "importId" TEXT,
    "rowsSent" INTEGER NOT NULL DEFAULT 0,
    "linesInError" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "summaryJson" JSONB,
    "errorSummaryJson" JSONB,
    "errorStorageUrl" TEXT,
    "errorPublicUrl" TEXT,
    "errorChecksum" TEXT,
    "errorSizeBytes" INTEGER,
    "errorSampleJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DecathlonImportRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DecathlonOfferSync_providerKey_key" ON "public"."DecathlonOfferSync"("providerKey");

-- CreateIndex
CREATE INDEX "DecathlonOfferSync_supplierVariantId_idx" ON "public"."DecathlonOfferSync"("supplierVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "DecathlonImportRun_runId_key" ON "public"."DecathlonImportRun"("runId");

-- CreateIndex
CREATE INDEX "DecathlonImportRun_flow_startedAt_idx" ON "public"."DecathlonImportRun"("flow", "startedAt");

-- CreateIndex
CREATE INDEX "DecathlonImportRun_importId_idx" ON "public"."DecathlonImportRun"("importId");
