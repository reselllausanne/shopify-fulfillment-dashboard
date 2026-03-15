-- Persist manual override metadata for non-StockX shipments
ALTER TABLE "public"."Shipment"
ADD COLUMN IF NOT EXISTS "manualOrderRef" TEXT,
ADD COLUMN IF NOT EXISTS "manualEtaMin" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "manualEtaMax" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "manualNote" TEXT;

