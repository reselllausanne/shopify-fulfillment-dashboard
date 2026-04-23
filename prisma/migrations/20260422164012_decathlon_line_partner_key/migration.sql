-- Add partner assignment per Decathlon order line
ALTER TABLE "DecathlonOrderLine" ADD COLUMN IF NOT EXISTS "partnerKey" TEXT;
CREATE INDEX IF NOT EXISTS "DecathlonOrderLine_partnerKey_idx" ON "DecathlonOrderLine" ("partnerKey");
