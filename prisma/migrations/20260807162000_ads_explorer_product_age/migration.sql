CREATE TABLE IF NOT EXISTS "public"."ads_explorer_product_age" (
  "id" text PRIMARY KEY,
  "shopify_product_id" bigint NOT NULL,
  "shopify_product_created_at" timestamptz NULL,
  "source" text NOT NULL,
  "unknown_reason" text NULL,
  "captured_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "ads_explorer_product_age_shopify_product_key"
  ON "public"."ads_explorer_product_age" ("shopify_product_id");
CREATE INDEX IF NOT EXISTS "ads_explorer_product_age_captured_idx"
  ON "public"."ads_explorer_product_age" ("captured_at");
