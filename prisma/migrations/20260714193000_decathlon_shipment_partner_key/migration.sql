-- AlterTable
ALTER TABLE "public"."DecathlonShipment" ADD COLUMN IF NOT EXISTS "partnerKey" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DecathlonShipment_partnerKey_idx" ON "public"."DecathlonShipment"("partnerKey");
