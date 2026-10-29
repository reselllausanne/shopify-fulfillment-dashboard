-- Cache barcodes.gg product/details lookups (hits + misses) keyed by style code.
CREATE TABLE IF NOT EXISTS "BarcodesGgStyleCache" (
  "id" TEXT NOT NULL,
  "styleCode" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "productUniqueId" TEXT,
  "productName" TEXT,
  "productBrand" TEXT,
  "responseJson" JSONB,
  "sizesTotal" INTEGER NOT NULL DEFAULT 0,
  "sizesWithValidGtin" INTEGER NOT NULL DEFAULT 0,
  "requestDebited" BOOLEAN NOT NULL DEFAULT false,
  "httpStatus" INTEGER,
  "errorMessage" TEXT,
  "lookedUpAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "refreshAfter" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BarcodesGgStyleCache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BarcodesGgStyleCache_styleCode_key" ON "BarcodesGgStyleCache"("styleCode");
CREATE INDEX IF NOT EXISTS "BarcodesGgStyleCache_status_idx" ON "BarcodesGgStyleCache"("status");
CREATE INDEX IF NOT EXISTS "BarcodesGgStyleCache_lookedUpAt_idx" ON "BarcodesGgStyleCache"("lookedUpAt");
