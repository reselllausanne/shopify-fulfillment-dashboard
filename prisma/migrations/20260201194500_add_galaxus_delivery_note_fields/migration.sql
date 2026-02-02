-- Add recipient + delivery note fields for Galaxus
ALTER TABLE "GalaxusOrder" ADD COLUMN IF NOT EXISTS "recipientName" TEXT;
ALTER TABLE "GalaxusOrder" ADD COLUMN IF NOT EXISTS "recipientAddress1" TEXT;
ALTER TABLE "GalaxusOrder" ADD COLUMN IF NOT EXISTS "recipientAddress2" TEXT;
ALTER TABLE "GalaxusOrder" ADD COLUMN IF NOT EXISTS "recipientPostalCode" TEXT;
ALTER TABLE "GalaxusOrder" ADD COLUMN IF NOT EXISTS "recipientCity" TEXT;
ALTER TABLE "GalaxusOrder" ADD COLUMN IF NOT EXISTS "recipientCountry" TEXT;
ALTER TABLE "GalaxusOrder" ADD COLUMN IF NOT EXISTS "recipientPhone" TEXT;
ALTER TABLE "GalaxusOrder" ADD COLUMN IF NOT EXISTS "referencePerson" TEXT;
ALTER TABLE "GalaxusOrder" ADD COLUMN IF NOT EXISTS "yourReference" TEXT;
ALTER TABLE "GalaxusOrder" ADD COLUMN IF NOT EXISTS "afterSalesHandling" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "deliveryNoteNumber" TEXT;
ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "deliveryNoteCreatedAt" TIMESTAMP(3);
ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "incoterms" TEXT;
ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "sscc" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Shipment_deliveryNoteNumber_key" ON "Shipment"("deliveryNoteNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "Shipment_sscc_key" ON "Shipment"("sscc");
