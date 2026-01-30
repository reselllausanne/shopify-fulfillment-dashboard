-- AlterTable
ALTER TABLE "OrderMatch" ADD COLUMN     "stockxPurchaseDate" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "OrderMatch_stockxPurchaseDate_idx" ON "OrderMatch"("stockxPurchaseDate");
