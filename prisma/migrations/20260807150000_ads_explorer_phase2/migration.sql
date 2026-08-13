-- Phase 2: Explorer Long Tail orchestration tables

CREATE TABLE IF NOT EXISTS "public"."ads_explorer_batches" (
  "id" text PRIMARY KEY,
  "status" text NOT NULL,
  "model_count" integer NOT NULL,
  "offer_count" integer NOT NULL,
  "daily_budget_micros" bigint NOT NULL,
  "max_cpc_micros" bigint NOT NULL,
  "planned_at" timestamptz NULL,
  "activated_at" timestamptz NULL,
  "ends_at" timestamptz NULL,
  "google_campaign_id" text NULL,
  "merchant_data_source_name" text NULL,
  "plan_hash" text NOT NULL,
  "stats_json" jsonb NULL,
  "error" text NULL,
  "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "ads_explorer_batches_status_idx"
  ON "public"."ads_explorer_batches" ("status");
CREATE INDEX IF NOT EXISTS "ads_explorer_batches_planned_at_idx"
  ON "public"."ads_explorer_batches" ("planned_at");
CREATE INDEX IF NOT EXISTS "ads_explorer_batches_activated_at_idx"
  ON "public"."ads_explorer_batches" ("activated_at");

CREATE TABLE IF NOT EXISTS "public"."ads_explorer_batch_models" (
  "id" text PRIMARY KEY,
  "batch_id" text NOT NULL,
  "shopify_product_id" bigint NOT NULL,
  "source_campaign_id" text NOT NULL,
  "source_campaign_name" text NOT NULL,
  "brand" text NOT NULL,
  "lifecycle_status" text NOT NULL,
  "active_offer_count" integer NOT NULL,
  "started_at" timestamptz NULL,
  "exited_at" timestamptz NULL,
  "exit_reason" text NULL,
  "impressions" bigint NOT NULL DEFAULT 0,
  "clicks" bigint NOT NULL DEFAULT 0,
  "cost_micros" bigint NOT NULL DEFAULT 0,
  "conversions" numeric(18,6) NOT NULL DEFAULT 0,
  "conversion_value" numeric(18,6) NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "ads_explorer_batch_models_batch_model_key"
  ON "public"."ads_explorer_batch_models" ("batch_id", "shopify_product_id");
CREATE INDEX IF NOT EXISTS "ads_explorer_batch_models_batch_status_idx"
  ON "public"."ads_explorer_batch_models" ("batch_id", "lifecycle_status");
CREATE INDEX IF NOT EXISTS "ads_explorer_batch_models_source_campaign_idx"
  ON "public"."ads_explorer_batch_models" ("source_campaign_id");
CREATE INDEX IF NOT EXISTS "ads_explorer_batch_models_shopify_product_idx"
  ON "public"."ads_explorer_batch_models" ("shopify_product_id");

CREATE TABLE IF NOT EXISTS "public"."ads_explorer_offer_writes" (
  "id" text PRIMARY KEY,
  "batch_id" text NOT NULL,
  "shopify_product_id" bigint NOT NULL,
  "offer_id" text NOT NULL,
  "content_language" text NOT NULL,
  "feed_label" text NOT NULL,
  "operation" text NOT NULL,
  "status" text NOT NULL,
  "attempts" integer NOT NULL DEFAULT 0,
  "last_error" text NULL,
  "processed_at" timestamptz NULL,
  "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "ads_explorer_offer_writes_key"
  ON "public"."ads_explorer_offer_writes"
  ("batch_id","offer_id","content_language","feed_label","operation");
CREATE INDEX IF NOT EXISTS "ads_explorer_offer_writes_batch_status_idx"
  ON "public"."ads_explorer_offer_writes" ("batch_id","status");
CREATE INDEX IF NOT EXISTS "ads_explorer_offer_writes_shopify_product_idx"
  ON "public"."ads_explorer_offer_writes" ("shopify_product_id");

CREATE TABLE IF NOT EXISTS "public"."ads_explorer_listing_backups" (
  "id" text PRIMARY KEY,
  "batch_id" text NOT NULL,
  "campaign_id" text NOT NULL,
  "asset_group_id" text NOT NULL,
  "captured_at" timestamptz NOT NULL,
  "tree_json" jsonb NOT NULL,
  "tree_hash" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "ads_explorer_listing_backups_batch_idx"
  ON "public"."ads_explorer_listing_backups" ("batch_id");
CREATE INDEX IF NOT EXISTS "ads_explorer_listing_backups_campaign_idx"
  ON "public"."ads_explorer_listing_backups" ("campaign_id");
CREATE INDEX IF NOT EXISTS "ads_explorer_listing_backups_captured_idx"
  ON "public"."ads_explorer_listing_backups" ("captured_at");
