-- Failed warehouse AWB scans (auto-scan misses). Kept ~30 days via app prune.
CREATE TABLE IF NOT EXISTS "public"."WarehouseScanMiss" (
    "id" TEXT NOT NULL,
    "rawCode" TEXT NOT NULL,
    "normalizedAwb" TEXT,
    "lookupCandidates" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "scanSessionKey" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WarehouseScanMiss_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "WarehouseScanMiss_createdAt_idx"
ON "public"."WarehouseScanMiss"("createdAt");

CREATE INDEX IF NOT EXISTS "WarehouseScanMiss_normalizedAwb_idx"
ON "public"."WarehouseScanMiss"("normalizedAwb");

CREATE INDEX IF NOT EXISTS "WarehouseScanMiss_rawCode_idx"
ON "public"."WarehouseScanMiss"("rawCode");

CREATE INDEX IF NOT EXISTS "WarehouseScanMiss_scanSessionKey_idx"
ON "public"."WarehouseScanMiss"("scanSessionKey");

CREATE INDEX IF NOT EXISTS "WarehouseScanMiss_status_idx"
ON "public"."WarehouseScanMiss"("status");
