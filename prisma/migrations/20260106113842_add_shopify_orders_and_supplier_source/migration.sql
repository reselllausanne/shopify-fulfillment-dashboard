-- CreateEnum
CREATE TYPE "SupplierSource" AS ENUM ('STOCKX', 'MANUAL', 'OTHER');

-- AlterTable
ALTER TABLE "OrderMatch" ADD COLUMN     "supplierSource" "SupplierSource" NOT NULL DEFAULT 'STOCKX';

-- CreateTable
CREATE TABLE "ShopifyOrder" (
    "shopifyOrderId" TEXT NOT NULL,
    "orderName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "totalSalesChf" DECIMAL(10,2) NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'CHF',
    "financialStatus" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopifyOrder_pkey" PRIMARY KEY ("shopifyOrderId")
);

-- CreateIndex
CREATE INDEX "ShopifyOrder_createdAt_idx" ON "ShopifyOrder"("createdAt");
