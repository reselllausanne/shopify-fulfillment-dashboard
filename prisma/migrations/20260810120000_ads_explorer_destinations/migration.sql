-- Explorer phase 3: three-destination routing (CORE_ALL / EXPLORER_ALL / LONG_TAIL_ALL).

ALTER TABLE "public"."ads_explorer_batch_models"
  ADD COLUMN IF NOT EXISTS "lt_impressions" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lt_clicks" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lt_cost_micros" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lt_conversions" DECIMAL(18,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lt_conversion_value" DECIMAL(18,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "metrics_synced_at" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "destination" TEXT NOT NULL DEFAULT 'EXPLORER_ALL',
  ADD COLUMN IF NOT EXISTS "pending_destination" TEXT,
  ADD COLUMN IF NOT EXISTS "destination_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "destination_applied_at" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "retest_at" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "cooldown_until" TIMESTAMPTZ(3);

CREATE INDEX IF NOT EXISTS "ads_explorer_batch_models_batch_destination_idx"
  ON "public"."ads_explorer_batch_models" ("batch_id", "destination");

CREATE INDEX IF NOT EXISTS "ads_explorer_batch_models_pending_destination_idx"
  ON "public"."ads_explorer_batch_models" ("pending_destination");

CREATE TABLE IF NOT EXISTS "public"."ads_explorer_campaigns" (
  "id" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "campaign_id" TEXT NOT NULL,
  "campaign_name" TEXT NOT NULL,
  "campaign_resource_name" TEXT,
  "ad_group_id" TEXT,
  "ad_group_resource_name" TEXT,
  "ad_group_ad_resource_name" TEXT,
  "budget_resource_name" TEXT,
  "include_label" TEXT,
  "stats_json" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ads_explorer_campaigns_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ads_explorer_campaigns_role_key"
  ON "public"."ads_explorer_campaigns" ("role");

CREATE INDEX IF NOT EXISTS "ads_explorer_campaigns_campaign_idx"
  ON "public"."ads_explorer_campaigns" ("campaign_id");
