-- AlterTable
ALTER TABLE "ShopifyOrder" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "netSalesChf" DECIMAL(10,2),
ADD COLUMN     "refundedAmountChf" DECIMAL(10,2);
