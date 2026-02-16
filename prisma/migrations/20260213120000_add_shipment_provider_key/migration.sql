-- Add providerKey to shipments for partner filtering
ALTER TABLE "public"."Shipment" ADD COLUMN "providerKey" TEXT;

CREATE INDEX "Shipment_providerKey_idx" ON "public"."Shipment"("providerKey");
