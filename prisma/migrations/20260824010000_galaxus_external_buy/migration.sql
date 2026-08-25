-- GalaxusExternalBuy: manual link to REI/WEL/etc supplier orders (not StockX).
CREATE TABLE IF NOT EXISTS "public"."GalaxusExternalBuy" (
    "id" TEXT NOT NULL,
    "galaxusOrderId" TEXT NOT NULL,
    "galaxusOrderLineId" TEXT NOT NULL,
    "unitIndex" INTEGER NOT NULL DEFAULT 0,
    "supplierKey" TEXT NOT NULL,
    "supplierOrderNumber" TEXT NOT NULL,
    "costAmount" DECIMAL(12,2),
    "currencyCode" TEXT NOT NULL DEFAULT 'CHF',
    "trackingNumber" TEXT,
    "trackingUrl" TEXT,
    "etaMin" TIMESTAMP(3),
    "etaMax" TIMESTAMP(3),
    "status" TEXT,
    "note" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GalaxusExternalBuy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "GalaxusExternalBuy_galaxusOrderLineId_unitIndex_key"
  ON "public"."GalaxusExternalBuy"("galaxusOrderLineId", "unitIndex");

CREATE INDEX IF NOT EXISTS "GalaxusExternalBuy_galaxusOrderId_idx"
  ON "public"."GalaxusExternalBuy"("galaxusOrderId");

CREATE INDEX IF NOT EXISTS "GalaxusExternalBuy_supplierKey_idx"
  ON "public"."GalaxusExternalBuy"("supplierKey");

CREATE INDEX IF NOT EXISTS "GalaxusExternalBuy_supplierOrderNumber_idx"
  ON "public"."GalaxusExternalBuy"("supplierOrderNumber");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'GalaxusExternalBuy_galaxusOrderId_fkey'
  ) THEN
    ALTER TABLE "public"."GalaxusExternalBuy"
      ADD CONSTRAINT "GalaxusExternalBuy_galaxusOrderId_fkey"
      FOREIGN KEY ("galaxusOrderId") REFERENCES "public"."GalaxusOrder"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'GalaxusExternalBuy_galaxusOrderLineId_fkey'
  ) THEN
    ALTER TABLE "public"."GalaxusExternalBuy"
      ADD CONSTRAINT "GalaxusExternalBuy_galaxusOrderLineId_fkey"
      FOREIGN KEY ("galaxusOrderLineId") REFERENCES "public"."GalaxusOrderLine"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
