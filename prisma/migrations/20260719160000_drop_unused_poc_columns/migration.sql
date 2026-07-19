-- Cleanup: drop the hand-applied POC columns from the first SSE experiment.
-- Verified 100% empty on prod before this migration (22,355 products /
-- 143,300 variants — zero non-null values in every column below).
-- The final design stores the raw payload in KickDBProduct.rawJson and the
-- Shopify workflow state in ShopifySyncState instead.

ALTER TABLE "public"."KickDBProduct"
  DROP COLUMN IF EXISTS "title",
  DROP COLUMN IF EXISTS "image",
  DROP COLUMN IF EXISTS "gallery",
  DROP COLUMN IF EXISTS "gallery360",
  DROP COLUMN IF EXISTS "productType",
  DROP COLUMN IF EXISTS "category",
  DROP COLUMN IF EXISTS "secondaryCategory",
  DROP COLUMN IF EXISTS "categories",
  DROP COLUMN IF EXISTS "breadcrumbs",
  DROP COLUMN IF EXISTS "market",
  DROP COLUMN IF EXISTS "currency",
  DROP COLUMN IF EXISTS "shopifySyncedAt",
  DROP COLUMN IF EXISTS "shopifyProductId",
  DROP COLUMN IF EXISTS "shopifyHandle",
  DROP COLUMN IF EXISTS "syncStatus",
  DROP COLUMN IF EXISTS "chSales14d",
  DROP COLUMN IF EXISTS "sseEventCount";

-- Note: "brand" / "description" also came from the POC migration on prod but
-- exist in schema.prisma and are populated by enrichJob — they stay.

DROP INDEX IF EXISTS "public"."KickDBProduct_syncStatus_lastFetchedAt_idx";

ALTER TABLE "public"."KickDBVariant"
  DROP COLUMN IF EXISTS "lowestAsk",
  DROP COLUMN IF EXISTS "askCount",
  DROP COLUMN IF EXISTS "expressLowestAsk",
  DROP COLUMN IF EXISTS "expressAskCount",
  DROP COLUMN IF EXISTS "lastSalePrice",
  DROP COLUMN IF EXISTS "currency",
  DROP COLUMN IF EXISTS "isExpress",
  DROP COLUMN IF EXISTS "variantImage",
  DROP COLUMN IF EXISTS "displaySize";

DROP TABLE IF EXISTS "public"."KickDBSseEvent";
