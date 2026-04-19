-- Add shipment placement fields and DELR uniqueness support
ALTER TABLE "public"."SupplierOrder" ADD COLUMN IF NOT EXISTS "shipmentId" TEXT;
ALTER TABLE "public"."Shipment" ADD COLUMN IF NOT EXISTS "supplierOrderRef" TEXT;
ALTER TABLE "public"."Shipment" ADD COLUMN IF NOT EXISTS "status" TEXT;
ALTER TABLE "public"."GalaxusEdiFile" ADD COLUMN IF NOT EXISTS "shipmentId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "SupplierOrder_shipmentId_key" ON "public"."SupplierOrder"("shipmentId");
CREATE INDEX IF NOT EXISTS "GalaxusEdiFile_shipmentId_idx" ON "public"."GalaxusEdiFile"("shipmentId");
CREATE UNIQUE INDEX IF NOT EXISTS "GalaxusEdiFile_shipmentId_direction_docType_key"
  ON "public"."GalaxusEdiFile"("shipmentId", "direction", "docType");
