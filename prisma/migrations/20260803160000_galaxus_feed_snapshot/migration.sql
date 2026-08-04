-- Materialized Galaxus stock/offer rows for fast full-file SFTP (post-sale path).
CREATE TABLE "public"."GalaxusFeedSnapshotMeta" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "stockRowCount" INTEGER NOT NULL DEFAULT 0,
  "offerRowCount" INTEGER NOT NULL DEFAULT 0,
  "stockHeadersJson" JSONB,
  "offerHeadersJson" JSONB,
  "rebuiltAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GalaxusFeedSnapshotMeta_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."GalaxusFeedStockSnapshot" (
  "providerKey" TEXT NOT NULL,
  "rowJson" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GalaxusFeedStockSnapshot_pkey" PRIMARY KEY ("providerKey")
);

CREATE INDEX "GalaxusFeedStockSnapshot_updatedAt_idx"
  ON "public"."GalaxusFeedStockSnapshot"("updatedAt");

CREATE TABLE "public"."GalaxusFeedOfferSnapshot" (
  "providerKey" TEXT NOT NULL,
  "rowJson" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GalaxusFeedOfferSnapshot_pkey" PRIMARY KEY ("providerKey")
);

CREATE INDEX "GalaxusFeedOfferSnapshot_updatedAt_idx"
  ON "public"."GalaxusFeedOfferSnapshot"("updatedAt");
