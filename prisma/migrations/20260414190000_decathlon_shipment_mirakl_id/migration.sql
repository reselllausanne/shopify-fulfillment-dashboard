-- Mirakl MMP shipment id (ST01 shipment_success.id) for OR72/OR73 packing slip scoping
ALTER TABLE "public"."DecathlonShipment" ADD COLUMN IF NOT EXISTS "miraklShipmentId" TEXT;

CREATE INDEX IF NOT EXISTS "DecathlonShipment_miraklShipmentId_idx" ON "public"."DecathlonShipment"("miraklShipmentId");
