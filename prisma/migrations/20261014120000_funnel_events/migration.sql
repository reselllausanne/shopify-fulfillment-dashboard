-- Shopify custom pixel funnel events (storefront + checkout steps). Additive only.

CREATE TABLE IF NOT EXISTS "public"."funnel_events" (
  "id" BIGSERIAL NOT NULL,
  "event_id" TEXT NOT NULL,
  "event_name" TEXT NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "client_id" TEXT,
  "session_id" TEXT,
  "checkout_token" TEXT,
  "page_path" TEXT,
  "landing_path" TEXT,
  "referrer_host" TEXT,
  "utm_source" TEXT,
  "utm_medium" TEXT,
  "utm_campaign" TEXT,
  "utm_content" TEXT,
  "utm_term" TEXT,
  "product_id" TEXT,
  "variant_id" TEXT,
  "product_title" TEXT,
  "variant_title" TEXT,
  "price" DECIMAL(12,2),
  "quantity" INTEGER,
  "item_count" INTEGER,
  "value" DECIMAL(12,2),
  "currency" TEXT,
  "discount_amount" DECIMAL(12,2),
  "shipping_method" TEXT,
  "shipping_type" TEXT,
  "shipping_price" DECIMAL(12,2),
  "delivery_description" TEXT,
  "payment_type" TEXT,
  "payment_gateway" TEXT,
  "country_code" TEXT,
  "zip_prefix" TEXT,
  "geo_country" TEXT,
  "device_type" TEXT,
  "os" TEXT,
  "browser" TEXT,
  "locale" TEXT,
  "webdriver" BOOLEAN,
  "ab_variant" TEXT,
  "alert_type" TEXT,
  "alert_target" TEXT,
  "alert_message" TEXT,
  "is_first_order" BOOLEAN,
  "props" JSONB,
  CONSTRAINT "funnel_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "funnel_events_event_id_key"
  ON "public"."funnel_events" ("event_id");

CREATE INDEX IF NOT EXISTS "funnel_events_event_name_created_at_idx"
  ON "public"."funnel_events" ("event_name", "created_at");

CREATE INDEX IF NOT EXISTS "funnel_events_checkout_token_idx"
  ON "public"."funnel_events" ("checkout_token");

CREATE INDEX IF NOT EXISTS "funnel_events_session_id_idx"
  ON "public"."funnel_events" ("session_id");

CREATE INDEX IF NOT EXISTS "funnel_events_created_at_idx"
  ON "public"."funnel_events" ("created_at");
