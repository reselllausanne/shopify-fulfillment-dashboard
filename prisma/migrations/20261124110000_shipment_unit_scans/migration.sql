-- Additive: per-unit scan evidence for Galaxus warehouse shipments.
-- Existing shipments keep requiresUnitScans = false (unaffected).
ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "requiresUnitScans" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "ShipmentUnitScan" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "galaxusOrderLineId" TEXT NOT NULL,
    "unitIndex" INTEGER NOT NULL,
    "gtin" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShipmentUnitScan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ShipmentUnitScan_shipmentId_galaxusOrderLineId_unitIndex_key"
  ON "ShipmentUnitScan" ("shipmentId", "galaxusOrderLineId", "unitIndex");
CREATE INDEX IF NOT EXISTS "ShipmentUnitScan_shipmentId_idx" ON "ShipmentUnitScan" ("shipmentId");

DO $$ BEGIN
  ALTER TABLE "ShipmentUnitScan" ADD CONSTRAINT "ShipmentUnitScan_shipmentId_fkey"
    FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
