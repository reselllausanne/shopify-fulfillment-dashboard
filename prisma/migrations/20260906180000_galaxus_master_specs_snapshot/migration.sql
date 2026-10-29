-- Master + Specs snapshot tables: mirror stock/offer pattern so nightly push
-- streams pre-built rows to CSV instead of rebuilding the whole catalog in RAM.

CREATE TABLE "public"."GalaxusFeedMasterSnapshot" (
  "providerKey" TEXT NOT NULL,
  "gtin"        TEXT,
  "supplierKey" TEXT,
  "rowJson"     JSONB NOT NULL,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GalaxusFeedMasterSnapshot_pkey" PRIMARY KEY ("providerKey")
);

CREATE INDEX "GalaxusFeedMasterSnapshot_updatedAt_idx"
  ON "public"."GalaxusFeedMasterSnapshot"("updatedAt");
CREATE INDEX "GalaxusFeedMasterSnapshot_supplierKey_idx"
  ON "public"."GalaxusFeedMasterSnapshot"("supplierKey");

-- Specs: many rows per SKU (one per (providerKey, specificationKey)).
-- providerKey ordering matches Galaxus expected sort so nightly export can
-- stream from the pk index without an in-memory sort.
CREATE TABLE "public"."GalaxusFeedSpecsSnapshot" (
  "providerKey"      TEXT NOT NULL,
  "specificationKey" TEXT NOT NULL,
  "rowJson"          JSONB NOT NULL,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GalaxusFeedSpecsSnapshot_pkey"
    PRIMARY KEY ("providerKey", "specificationKey")
);

CREATE INDEX "GalaxusFeedSpecsSnapshot_providerKey_idx"
  ON "public"."GalaxusFeedSpecsSnapshot"("providerKey");
CREATE INDEX "GalaxusFeedSpecsSnapshot_updatedAt_idx"
  ON "public"."GalaxusFeedSpecsSnapshot"("updatedAt");

-- Extend meta with master/specs row counts + headers + rebuild timestamps.
ALTER TABLE "public"."GalaxusFeedSnapshotMeta"
  ADD COLUMN "masterRowCount"    INTEGER,
  ADD COLUMN "specsRowCount"     INTEGER,
  ADD COLUMN "masterHeadersJson" JSONB,
  ADD COLUMN "specsHeadersJson"  JSONB,
  ADD COLUMN "masterRebuiltAt"   TIMESTAMP(3),
  ADD COLUMN "specsRebuiltAt"    TIMESTAMP(3);

