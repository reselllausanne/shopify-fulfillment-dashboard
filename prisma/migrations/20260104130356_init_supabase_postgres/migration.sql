-- CreateEnum
CREATE TYPE "ExpenseType" AS ENUM ('PERSONAL', 'BUSINESS');

-- CreateTable
CREATE TABLE "StockXToken" (
    "id" SERIAL NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockXToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderMatch" (
    "id" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "shopifyOrderName" TEXT NOT NULL,
    "shopifyLineItemId" TEXT NOT NULL,
    "shopifyProductTitle" TEXT NOT NULL,
    "shopifySku" TEXT,
    "shopifySizeEU" TEXT,
    "shopifyTotalPrice" DECIMAL(10,2) NOT NULL,
    "shopifyCurrencyCode" TEXT NOT NULL DEFAULT 'CHF',
    "stockxOrderNumber" TEXT NOT NULL,
    "stockxProductName" TEXT NOT NULL,
    "stockxSizeEU" TEXT,
    "stockxSkuKey" TEXT,
    "matchConfidence" TEXT NOT NULL,
    "matchScore" DECIMAL(5,2) NOT NULL,
    "matchType" TEXT NOT NULL,
    "matchReasons" TEXT NOT NULL,
    "timeDiffHours" DECIMAL(10,2),
    "stockxStatus" TEXT NOT NULL,
    "stockxEstimatedDelivery" TEXT,
    "lastStatusCheck" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stockxLastSeenAt" TIMESTAMP(3),
    "stockxMissingCount" INTEGER NOT NULL DEFAULT 0,
    "shopifyMetafieldsSynced" BOOLEAN NOT NULL DEFAULT false,
    "shopifyMetafieldsSetAt" TIMESTAMP(3),
    "supplierCost" DECIMAL(10,2) NOT NULL,
    "marginAmount" DECIMAL(10,2) NOT NULL,
    "marginPercent" DECIMAL(5,2) NOT NULL,
    "manualCostOverride" DECIMAL(10,2),
    "manualCaseStatus" TEXT,
    "manualRevenueAdjustment" DECIMAL(10,2),
    "manualNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderMetric" (
    "shopifyOrderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "grossSales" DECIMAL(10,2) NOT NULL,
    "marginChf" DECIMAL(10,2) NOT NULL,
    "marginPct" DECIMAL(5,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CHF',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderMetric_pkey" PRIMARY KEY ("shopifyOrderId")
);

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ExpenseType" NOT NULL DEFAULT 'PERSONAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAccount" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "last4" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'CHF',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalExpense" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'CHF',
    "categoryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "note" TEXT,
    "isBusiness" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalExpense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderMatch_shopifyLineItemId_key" ON "OrderMatch"("shopifyLineItemId");

-- CreateIndex
CREATE INDEX "OrderMatch_shopifyOrderId_idx" ON "OrderMatch"("shopifyOrderId");

-- CreateIndex
CREATE INDEX "OrderMatch_stockxOrderNumber_idx" ON "OrderMatch"("stockxOrderNumber");

-- CreateIndex
CREATE INDEX "OrderMatch_shopifyMetafieldsSynced_idx" ON "OrderMatch"("shopifyMetafieldsSynced");

-- CreateIndex
CREATE INDEX "OrderMatch_lastStatusCheck_idx" ON "OrderMatch"("lastStatusCheck");

-- CreateIndex
CREATE INDEX "OrderMatch_stockxLastSeenAt_idx" ON "OrderMatch"("stockxLastSeenAt");

-- CreateIndex
CREATE INDEX "OrderMetric_createdAt_idx" ON "OrderMetric"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_name_key" ON "ExpenseCategory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAccount_name_key" ON "PaymentAccount"("name");

-- CreateIndex
CREATE INDEX "PersonalExpense_date_idx" ON "PersonalExpense"("date");

-- CreateIndex
CREATE INDEX "PersonalExpense_categoryId_idx" ON "PersonalExpense"("categoryId");

-- CreateIndex
CREATE INDEX "PersonalExpense_accountId_idx" ON "PersonalExpense"("accountId");

-- CreateIndex
CREATE INDEX "PersonalExpense_isBusiness_idx" ON "PersonalExpense"("isBusiness");

-- AddForeignKey
ALTER TABLE "PersonalExpense" ADD CONSTRAINT "PersonalExpense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalExpense" ADD CONSTRAINT "PersonalExpense_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PaymentAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
