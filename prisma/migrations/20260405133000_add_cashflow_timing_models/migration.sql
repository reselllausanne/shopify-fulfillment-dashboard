-- Add payment gateway names to ShopifyOrder
ALTER TABLE "ShopifyOrder" ADD COLUMN "paymentGatewayNames" TEXT[];

-- CreateEnum
CREATE TYPE "CashInDelayType" AS ENUM ('BUSINESS_DAYS', 'CALENDAR_DAYS', 'NEXT_FRIDAY');

-- CreateEnum
CREATE TYPE "CashOutCadence" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "CashOutCategory" AS ENUM ('COGS', 'ADS', 'SHIPPING', 'SUBSCRIPTION', 'OWNER_DRAW', 'INSURANCE', 'FUEL', 'OTHER');

-- CreateTable
CREATE TABLE "CashFlowConfig" (
    "id" TEXT NOT NULL,
    "initialBalanceChf" DECIMAL(12,2) NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'CHF',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashFlowConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashInRule" (
    "id" TEXT NOT NULL,
    "channel" "MarketplaceChannel" NOT NULL,
    "paymentMethod" TEXT,
    "delayType" "CashInDelayType" NOT NULL,
    "delayValueDays" DECIMAL(5,2),
    "priority" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashInRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashOutRule" (
    "id" TEXT NOT NULL,
    "category" "CashOutCategory" NOT NULL,
    "cadence" "CashOutCadence" NOT NULL,
    "amountChf" DECIMAL(10,2),
    "dayOfWeek" INTEGER,
    "dayOfMonth" INTEGER,
    "offsetDays" INTEGER,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashOutRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashLedgerDaily" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "openingBalance" DECIMAL(12,2) NOT NULL,
    "cashIn" DECIMAL(12,2) NOT NULL,
    "cashOut" DECIMAL(12,2) NOT NULL,
    "closingBalance" DECIMAL(12,2) NOT NULL,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashLedgerDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CashInRule_channel_paymentMethod_idx" ON "CashInRule"("channel", "paymentMethod");

-- CreateIndex
CREATE INDEX "CashInRule_active_priority_idx" ON "CashInRule"("active", "priority");

-- CreateIndex
CREATE INDEX "CashOutRule_category_active_idx" ON "CashOutRule"("category", "active");

-- CreateIndex
CREATE UNIQUE INDEX "CashLedgerDaily_date_key" ON "CashLedgerDaily"("date");

-- CreateIndex
CREATE INDEX "CashLedgerDaily_date_idx" ON "CashLedgerDaily"("date");
