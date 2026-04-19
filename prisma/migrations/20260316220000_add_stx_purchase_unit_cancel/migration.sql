-- Add cancellation fields for StockX purchase units
ALTER TABLE "public"."StxPurchaseUnit"
ADD COLUMN "cancelledAt" TIMESTAMP WITH TIME ZONE,
ADD COLUMN "cancelledReason" TEXT;
