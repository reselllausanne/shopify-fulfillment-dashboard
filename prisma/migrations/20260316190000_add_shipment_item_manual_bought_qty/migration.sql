-- Add manual bought quantity for manual fulfillment tracking
ALTER TABLE "public"."ShipmentItem"
ADD COLUMN "manualBoughtQty" INTEGER NOT NULL DEFAULT 0;
