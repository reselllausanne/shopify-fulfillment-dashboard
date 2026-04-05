-- CreateEnum
CREATE TYPE "MarketplaceChannel" AS ENUM ('SHOPIFY', 'GALAXUS', 'DECATHLON');

-- CreateTable
CREATE TABLE "ShopifyPayout" (
    "id" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "transactionType" TEXT,
    "netAmount" DECIMAL(10,2) NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'CHF',
    "summaryJson" JSONB,
    "rawJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopifyPayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceCashAssumption" (
    "id" TEXT NOT NULL,
    "channel" "MarketplaceChannel" NOT NULL,
    "lagDays" INTEGER NOT NULL DEFAULT 2,
    "feePercent" DECIMAL(5,2),
    "feeFlatChf" DECIMAL(10,2),
    "activeFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activeTo" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceCashAssumption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceRemittance" (
    "id" TEXT NOT NULL,
    "channel" "MarketplaceChannel" NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "amountChf" DECIMAL(10,2) NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'CHF',
    "reference" TEXT,
    "sourceFile" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceRemittance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShopifyPayout_issuedAt_idx" ON "ShopifyPayout"("issuedAt");

-- CreateIndex
CREATE INDEX "MarketplaceCashAssumption_channel_activeFrom_idx" ON "MarketplaceCashAssumption"("channel", "activeFrom");

-- CreateIndex
CREATE INDEX "MarketplaceRemittance_channel_paidAt_idx" ON "MarketplaceRemittance"("channel", "paidAt");
