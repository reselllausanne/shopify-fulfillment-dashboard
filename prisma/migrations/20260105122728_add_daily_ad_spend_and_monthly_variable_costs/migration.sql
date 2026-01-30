-- CreateTable
CREATE TABLE "DailyAdSpend" (
    "date" TIMESTAMP(3) NOT NULL,
    "amountChf" DECIMAL(10,2) NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'google',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyAdSpend_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "MonthlyVariableCosts" (
    "monthKey" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "postageShippingCostChf" DECIMAL(10,2) NOT NULL,
    "fulfillmentCostChf" DECIMAL(10,2) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlyVariableCosts_pkey" PRIMARY KEY ("monthKey")
);

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyVariableCosts_year_month_key" ON "MonthlyVariableCosts"("year", "month");
