-- Funnel events: reconciliation keys (Shopify order id, click ids, consent snapshot). Additive only.

ALTER TABLE "public"."funnel_events"
  ADD COLUMN IF NOT EXISTS "order_id" TEXT,
  ADD COLUMN IF NOT EXISTS "gclid" TEXT,
  ADD COLUMN IF NOT EXISTS "gbraid" TEXT,
  ADD COLUMN IF NOT EXISTS "wbraid" TEXT,
  ADD COLUMN IF NOT EXISTS "fbclid" TEXT,
  ADD COLUMN IF NOT EXISTS "ttclid" TEXT,
  ADD COLUMN IF NOT EXISTS "msclkid" TEXT,
  ADD COLUMN IF NOT EXISTS "consent_marketing" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "consent_sale_of_data" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "pixel_version" TEXT;

CREATE INDEX IF NOT EXISTS "funnel_events_order_id_idx" ON "public"."funnel_events" ("order_id");
