-- SSE DB buffer: raw KicksDB payload on KickDBProduct + separate Shopify sync-state table.
-- Additive and idempotent. Safe on prod (columns nullable, table starts empty).

ALTER TABLE "public"."KickDBProduct"
  ADD COLUMN IF NOT EXISTS "rawJson"      JSONB,
  ADD COLUMN IF NOT EXISTS "rawFetchedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "KickDBProduct_rawFetchedAt_idx"
  ON "public"."KickDBProduct" ("rawFetchedAt");

CREATE TABLE IF NOT EXISTS "public"."ShopifySyncState" (
  "id"               TEXT NOT NULL,
  "kickdbProductId"  TEXT NOT NULL,
  "shopifyProductId" TEXT,
  "shopifyHandle"    TEXT,
  "syncStatus"       TEXT NOT NULL DEFAULT 'pending',
  "shopifySyncedAt"  TIMESTAMP(3),
  "priorityScore"    INTEGER NOT NULL DEFAULT 0,
  "lastError"        TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ShopifySyncState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ShopifySyncState_kickdbProductId_key"
  ON "public"."ShopifySyncState" ("kickdbProductId");

CREATE INDEX IF NOT EXISTS "ShopifySyncState_syncStatus_updatedAt_idx"
  ON "public"."ShopifySyncState" ("syncStatus", "updatedAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ShopifySyncState_kickdbProductId_fkey'
  ) THEN
    ALTER TABLE "public"."ShopifySyncState"
      ADD CONSTRAINT "ShopifySyncState_kickdbProductId_fkey"
      FOREIGN KEY ("kickdbProductId") REFERENCES "public"."KickDBProduct"("kickdbProductId")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
