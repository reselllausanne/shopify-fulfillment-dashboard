-- Shopify per-location inventory mirror (Phase 1: visibility).
-- Additive only. Shopify stays the master for physical stock; this table makes
-- per-location quantities visible to the DB/marketplace side.

CREATE TABLE IF NOT EXISTS "public"."ShopifyVariantLocationStock" (
    "id"               TEXT NOT NULL,
    "shopifyVariantId" TEXT NOT NULL,
    "inventoryItemId"  TEXT NOT NULL,
    "sku"              TEXT,
    "gtin"             TEXT,
    "locationId"       TEXT NOT NULL,
    "locationName"     TEXT NOT NULL,
    "sourceType"       TEXT NOT NULL,
    "priority"         INTEGER NOT NULL DEFAULT 99,
    "available"        INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ShopifyVariantLocationStock_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ShopifyVariantLocationStock_shopifyVariantId_locationId_key"
    ON "public"."ShopifyVariantLocationStock" ("shopifyVariantId", "locationId");
CREATE INDEX IF NOT EXISTS "ShopifyVariantLocationStock_locationId_available_idx"
    ON "public"."ShopifyVariantLocationStock" ("locationId", "available");
CREATE INDEX IF NOT EXISTS "ShopifyVariantLocationStock_sku_idx"
    ON "public"."ShopifyVariantLocationStock" ("sku");
CREATE INDEX IF NOT EXISTS "ShopifyVariantLocationStock_gtin_idx"
    ON "public"."ShopifyVariantLocationStock" ("gtin");
CREATE INDEX IF NOT EXISTS "ShopifyVariantLocationStock_sourceType_available_idx"
    ON "public"."ShopifyVariantLocationStock" ("sourceType", "available");
