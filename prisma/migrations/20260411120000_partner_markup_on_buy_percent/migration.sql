-- Partner Galaxus sell price: optional markup on (buy + shipping + buffer). Null = code default +25%.
ALTER TABLE "Partner" ADD COLUMN IF NOT EXISTS "markupOnBuyPercent" DECIMAL(8,6);
