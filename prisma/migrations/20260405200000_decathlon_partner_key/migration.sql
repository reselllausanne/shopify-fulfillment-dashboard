-- Add partner ownership to Decathlon orders for partner scoping
ALTER TABLE "DecathlonOrder" ADD COLUMN IF NOT EXISTS "partnerKey" TEXT;
CREATE INDEX IF NOT EXISTS "DecathlonOrder_partnerKey_idx" ON "DecathlonOrder" ("partnerKey");
