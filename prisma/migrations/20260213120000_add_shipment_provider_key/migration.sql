-- Add providerKey to shipments for partner filtering
ALTER TABLE "public"."Shipment" ADD COLUMN IF NOT EXISTS "providerKey" TEXT;

CREATE INDEX IF NOT EXISTS "Shipment_providerKey_idx" ON "public"."Shipment"("providerKey");
