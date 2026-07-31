-- Owned local stock ledger (cost + origin). Mirror stays Shopify qty sync.
-- Sale matching will decrement qtyAvailable in a transaction (no reservation table).

CREATE TYPE "public"."LocalStockOrigin" AS ENUM (
  'CUSTOMER_RETURN',
  'LEGACY_LIQUIDATION',
  'VOLUNTARY_PURCHASE',
  'ESSENTIALS',
  'OTHER'
);

CREATE TYPE "public"."LocalStockCostBasis" AS ENUM (
  'ACQUISITION',
  'ALREADY_EXPENSED',
  'UNKNOWN'
);

ALTER TYPE "public"."SupplierSource" ADD VALUE IF NOT EXISTS 'LOCAL';

CREATE TABLE "public"."LocalStockLot" (
    "id" TEXT NOT NULL,
    "shopifyProductId" TEXT,
    "shopifyVariantId" TEXT NOT NULL,
    "inventoryItemId" TEXT,
    "sku" TEXT,
    "gtin" TEXT,
    "sizeLabel" TEXT,
    "locationId" TEXT NOT NULL,
    "locationName" TEXT NOT NULL,
    "origin" "public"."LocalStockOrigin" NOT NULL,
    "costBasis" "public"."LocalStockCostBasis" NOT NULL,
    "unitCostChf" DECIMAL(10,2) NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'CHF',
    "qtyInitial" INTEGER NOT NULL,
    "qtyAvailable" INTEGER NOT NULL,
    "qtySold" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "sourceOrderMatchId" TEXT,
    "sourceMarketplaceReturnId" TEXT,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "migrationKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocalStockLot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LocalStockLot_migrationKey_key" ON "public"."LocalStockLot"("migrationKey");
CREATE INDEX "LocalStockLot_shopifyVariantId_status_qtyAvailable_idx" ON "public"."LocalStockLot"("shopifyVariantId", "status", "qtyAvailable");
CREATE INDEX "LocalStockLot_sku_qtyAvailable_idx" ON "public"."LocalStockLot"("sku", "qtyAvailable");
CREATE INDEX "LocalStockLot_gtin_qtyAvailable_idx" ON "public"."LocalStockLot"("gtin", "qtyAvailable");
CREATE INDEX "LocalStockLot_locationId_qtyAvailable_idx" ON "public"."LocalStockLot"("locationId", "qtyAvailable");
CREATE INDEX "LocalStockLot_sourceOrderMatchId_idx" ON "public"."LocalStockLot"("sourceOrderMatchId");

ALTER TABLE "public"."OrderMatch" ADD COLUMN IF NOT EXISTS "localStockLotId" TEXT;
CREATE INDEX IF NOT EXISTS "OrderMatch_localStockLotId_idx" ON "public"."OrderMatch"("localStockLotId");

ALTER TABLE "public"."LocalStockLot"
  ADD CONSTRAINT "LocalStockLot_sourceOrderMatchId_fkey"
  FOREIGN KEY ("sourceOrderMatchId") REFERENCES "public"."OrderMatch"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "public"."OrderMatch"
  ADD CONSTRAINT "OrderMatch_localStockLotId_fkey"
  FOREIGN KEY ("localStockLotId") REFERENCES "public"."LocalStockLot"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
