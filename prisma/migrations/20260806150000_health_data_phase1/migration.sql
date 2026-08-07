-- Personal health / triathlon tracking (admin-only). New tables only.

CREATE TABLE "public"."health_integration_accounts" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "provider_user_id" TEXT NOT NULL,
  "display_name" TEXT,
  "status" TEXT NOT NULL DEFAULT 'connected',
  "access_token_enc" TEXT NOT NULL,
  "refresh_token_enc" TEXT,
  "token_expires_at" TIMESTAMPTZ(3),
  "scope" TEXT,
  "watermark_at" TIMESTAMPTZ(3),
  "last_sync_at" TIMESTAMPTZ(3),
  "last_error" TEXT,
  "meta_json" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "health_integration_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "health_integration_accounts_provider_user_key"
  ON "public"."health_integration_accounts" ("provider", "provider_user_id");
CREATE INDEX "health_integration_accounts_provider_status_idx"
  ON "public"."health_integration_accounts" ("provider", "status");

CREATE TABLE "public"."health_integration_sync_runs" (
  "id" TEXT NOT NULL,
  "account_id" TEXT,
  "provider" TEXT NOT NULL,
  "command" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'running',
  "params_json" JSONB,
  "stats_json" JSONB,
  "error" TEXT,
  "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "health_integration_sync_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "health_integration_sync_runs_provider_started_idx"
  ON "public"."health_integration_sync_runs" ("provider", "started_at");
CREATE INDEX "health_integration_sync_runs_status_idx"
  ON "public"."health_integration_sync_runs" ("status");

ALTER TABLE "public"."health_integration_sync_runs"
  ADD CONSTRAINT "health_integration_sync_runs_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "public"."health_integration_accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "public"."health_raw_provider_events" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "provider_user_id" TEXT NOT NULL,
  "provider_record_id" TEXT NOT NULL,
  "resource_type" TEXT NOT NULL,
  "source_updated_at" TIMESTAMPTZ(3),
  "occurred_at" TIMESTAMPTZ(3),
  "synced_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "payload_json" JSONB NOT NULL,
  "transform_version" TEXT NOT NULL DEFAULT '1',
  "sync_run_id" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "health_raw_provider_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "health_raw_provider_events_key"
  ON "public"."health_raw_provider_events" ("provider", "provider_user_id", "resource_type", "provider_record_id");
CREATE INDEX "health_raw_provider_events_type_occurred_idx"
  ON "public"."health_raw_provider_events" ("provider", "resource_type", "occurred_at");
CREATE INDEX "health_raw_provider_events_sync_run_idx"
  ON "public"."health_raw_provider_events" ("sync_run_id");

CREATE TABLE "public"."health_sleep_sessions" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "provider_user_id" TEXT NOT NULL,
  "provider_record_id" TEXT NOT NULL,
  "source_updated_at" TIMESTAMPTZ(3),
  "synced_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "start_at" TIMESTAMPTZ(3) NOT NULL,
  "end_at" TIMESTAMPTZ(3) NOT NULL,
  "local_date" DATE NOT NULL,
  "duration_min" DOUBLE PRECISION,
  "time_in_bed_min" DOUBLE PRECISION,
  "sleep_score" DOUBLE PRECISION,
  "light_min" DOUBLE PRECISION,
  "deep_min" DOUBLE PRECISION,
  "rem_min" DOUBLE PRECISION,
  "awake_min" DOUBLE PRECISION,
  "transform_version" TEXT NOT NULL DEFAULT '1',
  "raw_payload" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "health_sleep_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "health_sleep_sessions_key"
  ON "public"."health_sleep_sessions" ("provider", "provider_user_id", "provider_record_id");
CREATE INDEX "health_sleep_sessions_local_date_idx"
  ON "public"."health_sleep_sessions" ("local_date");

CREATE TABLE "public"."health_activities" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "provider_user_id" TEXT NOT NULL,
  "provider_record_id" TEXT NOT NULL,
  "source_updated_at" TIMESTAMPTZ(3),
  "synced_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sport" TEXT NOT NULL,
  "start_at" TIMESTAMPTZ(3) NOT NULL,
  "end_at" TIMESTAMPTZ(3),
  "local_date" DATE NOT NULL,
  "duration_sec" INTEGER,
  "distance_m" DOUBLE PRECISION,
  "calories_kcal" DOUBLE PRECISION,
  "hr_avg" DOUBLE PRECISION,
  "hr_max" DOUBLE PRECISION,
  "power_avg" DOUBLE PRECISION,
  "power_max" DOUBLE PRECISION,
  "power_normalized" DOUBLE PRECISION,
  "cadence_avg" DOUBLE PRECISION,
  "speed_avg_mps" DOUBLE PRECISION,
  "elevation_gain_m" DOUBLE PRECISION,
  "training_effect" DOUBLE PRECISION,
  "training_load" DOUBLE PRECISION,
  "temperature_c" DOUBLE PRECISION,
  "rpe" DOUBLE PRECISION,
  "notes" TEXT,
  "transform_version" TEXT NOT NULL DEFAULT '1',
  "raw_payload" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "health_activities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "health_activities_key"
  ON "public"."health_activities" ("provider", "provider_user_id", "provider_record_id");
CREATE INDEX "health_activities_local_date_sport_idx"
  ON "public"."health_activities" ("local_date", "sport");
CREATE INDEX "health_activities_start_at_idx"
  ON "public"."health_activities" ("start_at");

CREATE TABLE "public"."health_activity_laps" (
  "id" TEXT NOT NULL,
  "activity_id" TEXT NOT NULL,
  "lap_index" INTEGER NOT NULL,
  "start_at" TIMESTAMPTZ(3),
  "duration_sec" INTEGER,
  "distance_m" DOUBLE PRECISION,
  "hr_avg" DOUBLE PRECISION,
  "power_avg" DOUBLE PRECISION,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "health_activity_laps_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "health_activity_laps_key"
  ON "public"."health_activity_laps" ("activity_id", "lap_index");

ALTER TABLE "public"."health_activity_laps"
  ADD CONSTRAINT "health_activity_laps_activity_id_fkey"
  FOREIGN KEY ("activity_id") REFERENCES "public"."health_activities"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "public"."health_body_measurements" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "provider_user_id" TEXT NOT NULL DEFAULT '',
  "provider_record_id" TEXT NOT NULL,
  "source_updated_at" TIMESTAMPTZ(3),
  "synced_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "measured_at" TIMESTAMPTZ(3) NOT NULL,
  "local_date" DATE NOT NULL,
  "weight_kg" DOUBLE PRECISION,
  "body_fat_pct" DOUBLE PRECISION,
  "muscle_mass_kg" DOUBLE PRECISION,
  "transform_version" TEXT NOT NULL DEFAULT '1',
  "raw_payload" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "health_body_measurements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "health_body_measurements_key"
  ON "public"."health_body_measurements" ("provider", "provider_user_id", "provider_record_id");
CREATE INDEX "health_body_measurements_local_date_idx"
  ON "public"."health_body_measurements" ("local_date");

CREATE TABLE "public"."health_nutrition_daily" (
  "id" TEXT NOT NULL,
  "local_date" DATE NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "calories_kcal" DOUBLE PRECISION,
  "carbs_g" DOUBLE PRECISION,
  "protein_g" DOUBLE PRECISION,
  "fat_g" DOUBLE PRECISION,
  "fiber_g" DOUBLE PRECISION,
  "sodium_mg" DOUBLE PRECISION,
  "water_ml" DOUBLE PRECISION,
  "caffeine_mg" DOUBLE PRECISION,
  "import_batch_id" TEXT,
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "health_nutrition_daily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "health_nutrition_daily_key"
  ON "public"."health_nutrition_daily" ("local_date", "source");
CREATE INDEX "health_nutrition_daily_local_date_idx"
  ON "public"."health_nutrition_daily" ("local_date");

CREATE TABLE "public"."health_nutrition_events" (
  "id" TEXT NOT NULL,
  "local_date" DATE NOT NULL,
  "occurred_at" TIMESTAMPTZ(3),
  "meal_label" TEXT,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "calories_kcal" DOUBLE PRECISION,
  "carbs_g" DOUBLE PRECISION,
  "protein_g" DOUBLE PRECISION,
  "fat_g" DOUBLE PRECISION,
  "fiber_g" DOUBLE PRECISION,
  "sodium_mg" DOUBLE PRECISION,
  "water_ml" DOUBLE PRECISION,
  "caffeine_mg" DOUBLE PRECISION,
  "activity_id" TEXT,
  "timing_tag" TEXT,
  "import_batch_id" TEXT,
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "health_nutrition_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "health_nutrition_events_local_date_idx"
  ON "public"."health_nutrition_events" ("local_date");
CREATE INDEX "health_nutrition_events_activity_idx"
  ON "public"."health_nutrition_events" ("activity_id");

CREATE TABLE "public"."health_subjective_checkins" (
  "id" TEXT NOT NULL,
  "local_date" DATE NOT NULL,
  "hunger" INTEGER,
  "fatigue" INTEGER,
  "motivation" INTEGER,
  "pain" INTEGER,
  "illness" BOOLEAN NOT NULL DEFAULT false,
  "rpe_session" DOUBLE PRECISION,
  "activity_id" TEXT,
  "free_text" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "health_subjective_checkins_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "health_subjective_checkins_local_date_key"
  ON "public"."health_subjective_checkins" ("local_date");

CREATE TABLE "public"."health_hydration_tests" (
  "id" TEXT NOT NULL,
  "tested_at" TIMESTAMPTZ(3) NOT NULL,
  "local_date" DATE NOT NULL,
  "sport" TEXT NOT NULL,
  "intensity" TEXT,
  "duration_hours" DOUBLE PRECISION NOT NULL,
  "weight_before_kg" DOUBLE PRECISION NOT NULL,
  "weight_after_kg" DOUBLE PRECISION NOT NULL,
  "fluid_consumed_l" DOUBLE PRECISION NOT NULL,
  "urine_produced_l" DOUBLE PRECISION NOT NULL,
  "temperature_c" DOUBLE PRECISION,
  "humidity_pct" DOUBLE PRECISION,
  "sodium_consumed_mg" DOUBLE PRECISION,
  "sweat_sodium_mg_per_l" DOUBLE PRECISION,
  "sweat_loss_l" DOUBLE PRECISION NOT NULL,
  "sweat_rate_l_per_hour" DOUBLE PRECISION NOT NULL,
  "formula_version" TEXT NOT NULL DEFAULT 'sweat_loss_v1',
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "health_hydration_tests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "health_hydration_tests_local_date_idx"
  ON "public"."health_hydration_tests" ("local_date");

CREATE TABLE "public"."health_daily_metrics" (
  "id" TEXT NOT NULL,
  "local_date" DATE NOT NULL,
  "sleep_min" DOUBLE PRECISION,
  "sleep_score" DOUBLE PRECISION,
  "resting_hr" DOUBLE PRECISION,
  "hrv_ms" DOUBLE PRECISION,
  "recovery_score" DOUBLE PRECISION,
  "stress_avg" DOUBLE PRECISION,
  "body_battery_max" DOUBLE PRECISION,
  "weight_kg" DOUBLE PRECISION,
  "steps" INTEGER,
  "calories_burned" DOUBLE PRECISION,
  "calories_consumed" DOUBLE PRECISION,
  "carbs_g" DOUBLE PRECISION,
  "protein_g" DOUBLE PRECISION,
  "fat_g" DOUBLE PRECISION,
  "training_load" DOUBLE PRECISION,
  "rpe_avg" DOUBLE PRECISION,
  "activity_count" INTEGER NOT NULL DEFAULT 0,
  "sources_json" JSONB,
  "computed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "health_daily_metrics_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "health_daily_metrics_local_date_key"
  ON "public"."health_daily_metrics" ("local_date");

CREATE TABLE "public"."health_daily_training_load" (
  "id" TEXT NOT NULL,
  "local_date" DATE NOT NULL,
  "load_sum" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "duration_sec" INTEGER NOT NULL DEFAULT 0,
  "activity_count" INTEGER NOT NULL DEFAULT 0,
  "acute_7d" DOUBLE PRECISION,
  "chronic_28d" DOUBLE PRECISION,
  "ratio" DOUBLE PRECISION,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "health_daily_training_load_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "health_daily_training_load_local_date_key"
  ON "public"."health_daily_training_load" ("local_date");

CREATE TABLE "public"."health_personal_baselines" (
  "id" TEXT NOT NULL,
  "metric_key" TEXT NOT NULL,
  "window_days" INTEGER NOT NULL,
  "as_of_date" DATE NOT NULL,
  "sample_count" INTEGER NOT NULL,
  "mean" DOUBLE PRECISION,
  "median" DOUBLE PRECISION,
  "stddev" DOUBLE PRECISION,
  "trend_slope" DOUBLE PRECISION,
  "meta_json" JSONB,
  "computed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "health_personal_baselines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "health_personal_baselines_key"
  ON "public"."health_personal_baselines" ("metric_key", "window_days", "as_of_date");
CREATE INDEX "health_personal_baselines_metric_date_idx"
  ON "public"."health_personal_baselines" ("metric_key", "as_of_date");

CREATE TABLE "public"."health_generated_insights" (
  "id" TEXT NOT NULL,
  "insight_key" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "period_from" DATE NOT NULL,
  "period_to" DATE NOT NULL,
  "factual_observation" TEXT NOT NULL,
  "hypothesis" TEXT NOT NULL,
  "confidence" TEXT NOT NULL,
  "data_used_json" JSONB NOT NULL,
  "limitations" TEXT NOT NULL,
  "cautious_action" TEXT NOT NULL,
  "medical_disclaimer" TEXT NOT NULL,
  "feedback" TEXT,
  "generated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "health_generated_insights_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "health_generated_insights_period_key_idx"
  ON "public"."health_generated_insights" ("period_to", "insight_key");
CREATE INDEX "health_generated_insights_feedback_idx"
  ON "public"."health_generated_insights" ("feedback");
