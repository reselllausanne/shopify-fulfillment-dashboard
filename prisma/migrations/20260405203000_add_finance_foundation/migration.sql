-- CreateEnum
CREATE TYPE "BankAccountType" AS ENUM ('BANK', 'CARD');

-- CreateEnum
CREATE TYPE "BankImportSource" AS ENUM ('CAMT053', 'CSV');

-- CreateEnum
CREATE TYPE "FinanceDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "FinanceCategory" AS ENUM ('SALES', 'REFUND', 'COGS', 'COMMISSION', 'SHIPPING', 'ADS', 'SUBSCRIPTION', 'OWNER_DRAW', 'INSURANCE', 'FUEL', 'TAX', 'OTHER');

-- CreateEnum
CREATE TYPE "ManualEventSourceType" AS ENUM ('MANUAL', 'RECURRING', 'IMPORT');

-- CreateEnum
CREATE TYPE "ReconciliationLinkedType" AS ENUM ('MANUAL_EVENT', 'EXPECTED_CASH', 'OPERATING_EVENT', 'SHOPIFY_PAYOUT', 'MARKETPLACE_REMITTANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('UNMATCHED', 'MATCHED', 'PARTIAL');

-- AlterTable
ALTER TABLE "RecurringExpense" ADD COLUMN "endDate" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "BankAccount" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "iban" TEXT,
    "bankName" TEXT,
    "currencyCode" TEXT NOT NULL DEFAULT 'CHF',
    "accountType" "BankAccountType" NOT NULL DEFAULT 'BANK',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankStatementImport" (
    "id" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "sourceType" "BankImportSource" NOT NULL,
    "sourceFileName" TEXT,
    "fileHash" TEXT NOT NULL,
    "statementFrom" TIMESTAMP(3),
    "statementTo" TIMESTAMP(3),
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadataJson" JSONB,

    CONSTRAINT "BankStatementImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankTransaction" (
    "id" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "statementImportId" TEXT,
    "externalId" TEXT,
    "bookingDate" TIMESTAMP(3) NOT NULL,
    "valueDate" TIMESTAMP(3),
    "amount" DECIMAL(12,2) NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'CHF',
    "direction" "FinanceDirection" NOT NULL,
    "counterpartyName" TEXT,
    "counterpartyIban" TEXT,
    "reference" TEXT,
    "remittanceInfo" TEXT,
    "transactionType" TEXT,
    "fingerprint" TEXT NOT NULL,
    "rawJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankBalanceSnapshot" (
    "id" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL,
    "balance" DECIMAL(12,2) NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'CHF',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankBalanceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManualFinanceEvent" (
    "id" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'CHF',
    "direction" "FinanceDirection" NOT NULL,
    "category" "FinanceCategory" NOT NULL DEFAULT 'OTHER',
    "description" TEXT,
    "expenseCategoryId" TEXT,
    "bankAccountId" TEXT,
    "sourceType" "ManualEventSourceType" NOT NULL DEFAULT 'MANUAL',
    "sourceId" TEXT,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManualFinanceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperatingEvent" (
    "id" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3) NOT NULL,
    "channel" "MarketplaceChannel",
    "eventType" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'CHF',
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperatingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpectedCashEvent" (
    "id" TEXT NOT NULL,
    "expectedDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'CHF',
    "direction" "FinanceDirection" NOT NULL,
    "category" "FinanceCategory" NOT NULL DEFAULT 'OTHER',
    "channel" "MarketplaceChannel",
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpectedCashEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankReconciliationLink" (
    "id" TEXT NOT NULL,
    "bankTransactionId" TEXT NOT NULL,
    "linkedType" "ReconciliationLinkedType" NOT NULL,
    "linkedId" TEXT NOT NULL,
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'MATCHED',
    "matchedAmount" DECIMAL(12,2),
    "confidence" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankReconciliationLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BankAccount_iban_key" ON "BankAccount"("iban");

-- CreateIndex
CREATE UNIQUE INDEX "BankStatementImport_bankAccountId_fileHash_key" ON "BankStatementImport"("bankAccountId", "fileHash");

-- CreateIndex
CREATE INDEX "BankStatementImport_bankAccountId_importedAt_idx" ON "BankStatementImport"("bankAccountId", "importedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransaction_bankAccountId_fingerprint_key" ON "BankTransaction"("bankAccountId", "fingerprint");

-- CreateIndex
CREATE INDEX "BankTransaction_bankAccountId_bookingDate_idx" ON "BankTransaction"("bankAccountId", "bookingDate");

-- CreateIndex
CREATE INDEX "BankTransaction_bankAccountId_externalId_idx" ON "BankTransaction"("bankAccountId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "BankBalanceSnapshot_bankAccountId_snapshotDate_key" ON "BankBalanceSnapshot"("bankAccountId", "snapshotDate");

-- CreateIndex
CREATE INDEX "BankBalanceSnapshot_bankAccountId_snapshotDate_idx" ON "BankBalanceSnapshot"("bankAccountId", "snapshotDate");

-- CreateIndex
CREATE UNIQUE INDEX "ManualFinanceEvent_sourceType_sourceId_eventDate_key" ON "ManualFinanceEvent"("sourceType", "sourceId", "eventDate");

-- CreateIndex
CREATE INDEX "ManualFinanceEvent_eventDate_idx" ON "ManualFinanceEvent"("eventDate");

-- CreateIndex
CREATE INDEX "ManualFinanceEvent_sourceType_sourceId_idx" ON "ManualFinanceEvent"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "OperatingEvent_eventDate_idx" ON "OperatingEvent"("eventDate");

-- CreateIndex
CREATE INDEX "OperatingEvent_channel_idx" ON "OperatingEvent"("channel");

-- CreateIndex
CREATE INDEX "ExpectedCashEvent_expectedDate_idx" ON "ExpectedCashEvent"("expectedDate");

-- CreateIndex
CREATE INDEX "ExpectedCashEvent_channel_idx" ON "ExpectedCashEvent"("channel");

-- CreateIndex
CREATE INDEX "BankReconciliationLink_linkedType_linkedId_idx" ON "BankReconciliationLink"("linkedType", "linkedId");

-- CreateIndex
CREATE INDEX "BankReconciliationLink_status_idx" ON "BankReconciliationLink"("status");

-- AddForeignKey
ALTER TABLE "BankStatementImport" ADD CONSTRAINT "BankStatementImport_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_statementImportId_fkey" FOREIGN KEY ("statementImportId") REFERENCES "BankStatementImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankBalanceSnapshot" ADD CONSTRAINT "BankBalanceSnapshot_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualFinanceEvent" ADD CONSTRAINT "ManualFinanceEvent_expenseCategoryId_fkey" FOREIGN KEY ("expenseCategoryId") REFERENCES "ExpenseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualFinanceEvent" ADD CONSTRAINT "ManualFinanceEvent_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankReconciliationLink" ADD CONSTRAINT "BankReconciliationLink_bankTransactionId_fkey" FOREIGN KEY ("bankTransactionId") REFERENCES "BankTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
