-- Phase 1 Google Ads analytics POC: read-only ingestion of Google Ads history.
-- Three tables only, no partitioning, no materialized views.

CREATE TABLE "public"."ads_sync_runs" (
  "id" TEXT NOT NULL,
  "command" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'running',
  "params_json" JSONB,
  "stats_json" JSONB,
  "error" TEXT,
  "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ads_sync_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ads_sync_runs_command_started_at_idx"
  ON "public"."ads_sync_runs" ("command", "started_at");

CREATE INDEX "ads_sync_runs_status_idx"
  ON "public"."ads_sync_runs" ("status");

CREATE TABLE "public"."ads_campaign_daily" (
  "id" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "campaign_id" BIGINT NOT NULL,
  "campaign_name" TEXT NOT NULL DEFAULT '',
  "campaign_status" TEXT NOT NULL DEFAULT '',
  "channel_type" TEXT NOT NULL DEFAULT '',
  "impressions" BIGINT NOT NULL DEFAULT 0,
  "clicks" BIGINT NOT NULL DEFAULT 0,
  "cost_micros" BIGINT NOT NULL DEFAULT 0,
  "conversions" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "conversion_value" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ads_campaign_daily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ads_campaign_daily_key"
  ON "public"."ads_campaign_daily" ("date", "campaign_id");

CREATE INDEX "ads_campaign_daily_campaign_id_date_idx"
  ON "public"."ads_campaign_daily" ("campaign_id", "date");

-- Every canonical-key column is NOT NULL with an empty-string / zero default:
-- a NULL never matches in a Postgres unique index, which would silently turn
-- every ON CONFLICT upsert into a duplicate insert.
CREATE TABLE "public"."ads_product_daily" (
  "id" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "campaign_id" BIGINT NOT NULL,
  "merchant_id" BIGINT NOT NULL DEFAULT 0,
  "feed_label" TEXT NOT NULL DEFAULT '',
  "language_code" TEXT NOT NULL DEFAULT '',
  "offer_id" TEXT NOT NULL DEFAULT '',
  "campaign_name" TEXT NOT NULL DEFAULT '',
  "title" TEXT NOT NULL DEFAULT '',
  "brand" TEXT NOT NULL DEFAULT '',
  "product_type" TEXT NOT NULL DEFAULT '',
  "custom_attr0" TEXT NOT NULL DEFAULT '',
  "custom_attr1" TEXT NOT NULL DEFAULT '',
  "custom_attr2" TEXT NOT NULL DEFAULT '',
  "custom_attr3" TEXT NOT NULL DEFAULT '',
  "custom_attr4" TEXT NOT NULL DEFAULT '',
  "impressions" BIGINT NOT NULL DEFAULT 0,
  "clicks" BIGINT NOT NULL DEFAULT 0,
  "cost_micros" BIGINT NOT NULL DEFAULT 0,
  "conversions" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "conversion_value" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "shopify_product_id" BIGINT,
  "shopify_variant_id" BIGINT,
  "attribute_conflict" BOOLEAN NOT NULL DEFAULT false,
  "source_rows" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ads_product_daily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ads_product_daily_key"
  ON "public"."ads_product_daily" ("date", "campaign_id", "merchant_id", "feed_label", "language_code", "offer_id");

CREATE INDEX "ads_product_daily_date_idx"
  ON "public"."ads_product_daily" ("date");

CREATE INDEX "ads_product_daily_campaign_id_date_idx"
  ON "public"."ads_product_daily" ("campaign_id", "date");

CREATE INDEX "ads_product_daily_offer_id_idx"
  ON "public"."ads_product_daily" ("offer_id");

CREATE INDEX "ads_product_daily_shopify_product_id_idx"
  ON "public"."ads_product_daily" ("shopify_product_id");
