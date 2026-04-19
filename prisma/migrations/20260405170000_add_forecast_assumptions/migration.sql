-- CreateEnum
CREATE TYPE "ForecastMode" AS ENUM ('AUTO', 'MANUAL', 'HYBRID');

-- CreateTable
CREATE TABLE "ForecastAssumption" (
    "id" TEXT NOT NULL,
    "channel" "MarketplaceChannel" NOT NULL,
    "mode" "ForecastMode" NOT NULL DEFAULT 'HYBRID',
    "expectedDailySales" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "expectedDailyOrders" INTEGER,
    "growthRatePct" DECIMAL(5,2),
    "payoutDelayDays" DECIMAL(5,2),
    "commissionRatePct" DECIMAL(5,2),
    "refundRatePct" DECIMAL(5,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForecastAssumption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ForecastAssumption_channel_key" ON "ForecastAssumption"("channel");
