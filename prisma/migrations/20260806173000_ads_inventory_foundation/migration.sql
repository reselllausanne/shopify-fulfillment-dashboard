-- Ads inventory foundation (read-only external systems, writable local DB).
-- Adds current shopping_product snapshot + daily funnel snapshots + campaign settings snapshots.

CREATE TABLE "public"."ads_shopping_product_current" (
  "id" TEXT NOT NULL,
  "merchant_id" BIGINT NOT NULL,
  "channel" TEXT NOT NULL,
  "language_code" TEXT NOT NULL,
  "feed_label" TEXT NOT NULL,
  "offer_id" TEXT NOT NULL,
  "title" TEXT NOT NULL DEFAULT '',
  "brand" TEXT NOT NULL DEFAULT '',
  "product_type" TEXT NOT NULL DEFAULT '',
  "custom_attr0" TEXT NOT NULL DEFAULT '',
  "custom_attr1" TEXT NOT NULL DEFAULT '',
  "custom_attr2" TEXT NOT NULL DEFAULT '',
  "custom_attr3" TEXT NOT NULL DEFAULT '',
  "custom_attr4" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT '',
  "availability" TEXT NOT NULL DEFAULT '',
  "shopify_product_id" BIGINT,
  "shopify_variant_id" BIGINT,
  "targeted_campaign_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "targeted_campaign_names" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "last_seen_run_id" TEXT NOT NULL,
  "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "is_current" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ads_shopping_product_current_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ads_shopping_product_current_key"
  ON "public"."ads_shopping_product_current" ("merchant_id", "channel", "language_code", "feed_label", "offer_id");

CREATE INDEX "ads_shopping_product_current_shopify_product_id_idx"
  ON "public"."ads_shopping_product_current" ("shopify_product_id");

CREATE INDEX "ads_shopping_product_current_shopify_variant_id_idx"
  ON "public"."ads_shopping_product_current" ("shopify_variant_id");

CREATE INDEX "ads_shopping_product_current_is_current_idx"
  ON "public"."ads_shopping_product_current" ("is_current");

CREATE INDEX "ads_shopping_product_current_last_seen_run_id_idx"
  ON "public"."ads_shopping_product_current" ("last_seen_run_id");

CREATE INDEX "ads_shopping_product_current_targeted_campaign_ids_gin_idx"
  ON "public"."ads_shopping_product_current" USING GIN ("targeted_campaign_ids");

CREATE TABLE "public"."ads_inventory_funnel_daily" (
  "id" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "granularity" TEXT NOT NULL,
  "window_days" INTEGER NOT NULL DEFAULT 30,
  "period_start" DATE NOT NULL,
  "period_end" DATE NOT NULL,
  "total" INTEGER NOT NULL,
  "targeted" INTEGER NOT NULL,
  "not_targeted" INTEGER NOT NULL,
  "with_impressions_7d" INTEGER NOT NULL,
  "with_impressions_30d" INTEGER NOT NULL,
  "with_clicks_7d" INTEGER NOT NULL,
  "with_clicks_30d" INTEGER NOT NULL,
  "with_spend_30d" INTEGER NOT NULL,
  "with_conversions_30d" INTEGER NOT NULL,
  "spend_zero_conversion_30d" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "unmapped" INTEGER NOT NULL,
  "stats_json" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ads_inventory_funnel_daily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ads_inventory_funnel_daily_key"
  ON "public"."ads_inventory_funnel_daily" ("date", "granularity", "window_days");

CREATE INDEX "ads_inventory_funnel_daily_date_granularity_idx"
  ON "public"."ads_inventory_funnel_daily" ("date", "granularity");

CREATE TABLE "public"."ads_campaign_settings_daily" (
  "id" TEXT NOT NULL,
  "snapshot_date" DATE NOT NULL,
  "campaign_id" BIGINT NOT NULL,
  "campaign_name" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT '',
  "channel_type" TEXT NOT NULL DEFAULT '',
  "budget_micros" BIGINT,
  "bidding_strategy" TEXT,
  "target_roas" DECIMAL(12,6),
  "merchant_id" BIGINT,
  "feed_label" TEXT,
  "listing_group_filters" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ads_campaign_settings_daily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ads_campaign_settings_daily_key"
  ON "public"."ads_campaign_settings_daily" ("snapshot_date", "campaign_id");

CREATE INDEX "ads_campaign_settings_daily_snapshot_date_idx"
  ON "public"."ads_campaign_settings_daily" ("snapshot_date");

CREATE INDEX "ads_campaign_settings_daily_campaign_id_idx"
  ON "public"."ads_campaign_settings_daily" ("campaign_id");
