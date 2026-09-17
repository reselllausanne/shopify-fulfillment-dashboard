-- Retention timestamps for StockxInboundPackage (do not bump arrivedAt on every cron).
ALTER TABLE "public"."StockxInboundPackage"
  ADD COLUMN IF NOT EXISTS "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "public"."StockxInboundPackage"
  ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "public"."StockxInboundPackage"
  ADD COLUMN IF NOT EXISTS "stockxEventAt" TIMESTAMP(3);

-- Backfill from existing columns when present.
UPDATE "public"."StockxInboundPackage"
SET
  "firstSeenAt" = COALESCE("firstSeenAt", "arrivedAt", "createdAt", CURRENT_TIMESTAMP),
  "lastSeenAt" = COALESCE("lastSeenAt", "updatedAt", "arrivedAt", CURRENT_TIMESTAMP),
  "stockxEventAt" = COALESCE("stockxEventAt", "purchaseDate", "arrivedAt");

CREATE INDEX IF NOT EXISTS "StockxInboundPackage_firstSeenAt_idx"
  ON "public"."StockxInboundPackage"("firstSeenAt");

CREATE INDEX IF NOT EXISTS "StockxInboundPackage_lastSeenAt_idx"
  ON "public"."StockxInboundPackage"("lastSeenAt");

CREATE INDEX IF NOT EXISTS "StockxInboundPackage_stockxEventAt_idx"
  ON "public"."StockxInboundPackage"("stockxEventAt");

CREATE INDEX IF NOT EXISTS "StockxInboundPackage_stockxAccountKey_stockxEventAt_idx"
  ON "public"."StockxInboundPackage"("stockxAccountKey", "stockxEventAt");

CREATE INDEX IF NOT EXISTS "StockxInboundPackage_stockxAccountKey_firstSeenAt_idx"
  ON "public"."StockxInboundPackage"("stockxAccountKey", "firstSeenAt");
