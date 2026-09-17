-- Supplier stock reconciliation: proof-based publish gate + review queue.

CREATE TABLE "public"."supplier_stock_policies" (
    "id" TEXT NOT NULL,
    "supplier_key" TEXT NOT NULL,
    "supplier_code" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'review_required',
    "scrape_interval_hours" INTEGER NOT NULL DEFAULT 24,
    "heavy_source" BOOLEAN NOT NULL DEFAULT false,
    "consecutive_invalid_runs" INTEGER NOT NULL DEFAULT 0,
    "last_valid_run_at" TIMESTAMPTZ(3),
    "last_invalid_run_at" TIMESTAMPTZ(3),
    "last_scrape_run_id" INTEGER,
    "paused_at" TIMESTAMPTZ(3),
    "paused_reason" TEXT,
    "approved_at" TIMESTAMPTZ(3),
    "approved_by" TEXT,
    "notes" TEXT,
    "config_json" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "supplier_stock_policies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "supplier_stock_policies_supplier_key_key"
    ON "public"."supplier_stock_policies"("supplier_key");

CREATE INDEX "supplier_stock_policies_status_idx"
    ON "public"."supplier_stock_policies"("status");

CREATE TABLE "public"."supplier_variant_evidence" (
    "id" TEXT NOT NULL,
    "supplier_key" TEXT NOT NULL,
    "supplier_variant_id" TEXT NOT NULL,
    "product_url" TEXT,
    "variant_url" TEXT,
    "supplier_sku" TEXT,
    "gtin" TEXT,
    "manufacturer_ref" TEXT,
    "product_name" TEXT,
    "variant_attributes_json" JSONB,
    "source_price" DECIMAL(12,2),
    "currency" TEXT,
    "shipping_rule" TEXT,
    "source_lead_time_days" INTEGER,
    "supplier_stock_qty" INTEGER,
    "availability_status" TEXT NOT NULL,
    "availability_signal" TEXT,
    "quantity_source" TEXT,
    "published_qty" INTEGER NOT NULL DEFAULT 0,
    "zero_reason" TEXT,
    "confidence_status" TEXT,
    "confidence_score" DOUBLE PRECISION,
    "last_proof_at" TIMESTAMPTZ(3),
    "last_observed_at" TIMESTAMPTZ(3),
    "source_scrape_run_id" INTEGER,
    "raw_parse_json" JSONB,
    "needs_review" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "supplier_variant_evidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "supplier_variant_evidence_supplier_variant_id_key"
    ON "public"."supplier_variant_evidence"("supplier_variant_id");

CREATE INDEX "supplier_variant_evidence_supplier_key_idx"
    ON "public"."supplier_variant_evidence"("supplier_key");

CREATE INDEX "supplier_variant_evidence_needs_review_idx"
    ON "public"."supplier_variant_evidence"("needs_review");

CREATE TABLE "public"."supplier_stock_review_items" (
    "id" TEXT NOT NULL,
    "supplier_key" TEXT NOT NULL,
    "supplier_variant_id" TEXT NOT NULL,
    "gtin" TEXT,
    "supplier_sku" TEXT,
    "manufacturer_ref" TEXT,
    "product_name" TEXT,
    "product_url" TEXT,
    "image_url" TEXT,
    "db_price" DECIMAL(12,2),
    "found_price" DECIMAL(12,2),
    "db_qty" INTEGER,
    "proposed_qty" INTEGER,
    "found_lead_time_days" INTEGER,
    "proposed_status" TEXT,
    "reason" TEXT NOT NULL,
    "last_proof_at" TIMESTAMPTZ(3),
    "source_scrape_run_id" INTEGER,
    "raw_parse_json" JSONB,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolved_at" TIMESTAMPTZ(3),
    "resolved_by" TEXT,
    "resolution_note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "supplier_stock_review_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "supplier_stock_review_items_supplier_key_status_idx"
    ON "public"."supplier_stock_review_items"("supplier_key", "status");

CREATE INDEX "supplier_stock_review_items_supplier_variant_id_idx"
    ON "public"."supplier_stock_review_items"("supplier_variant_id");

CREATE TABLE "public"."supplier_scrape_quality_runs" (
    "id" TEXT NOT NULL,
    "supplier_key" TEXT NOT NULL,
    "scrape_run_id" INTEGER NOT NULL,
    "valid" BOOLEAN NOT NULL,
    "invalid_reason" TEXT,
    "complete_snapshot" BOOLEAN NOT NULL DEFAULT false,
    "products_discovered" INTEGER NOT NULL DEFAULT 0,
    "variants_processed" INTEGER NOT NULL DEFAULT 0,
    "confirmed_in_stock" INTEGER NOT NULL DEFAULT 0,
    "confirmed_out_of_stock" INTEGER NOT NULL DEFAULT 0,
    "preorders" INTEGER NOT NULL DEFAULT 0,
    "pages_missing" INTEGER NOT NULL DEFAULT 0,
    "price_missing" INTEGER NOT NULL DEFAULT 0,
    "variant_uncertain" INTEGER NOT NULL DEFAULT 0,
    "qty_zeroed" INTEGER NOT NULL DEFAULT 0,
    "excluded_by_dimension" INTEGER NOT NULL DEFAULT 0,
    "error_rate" DOUBLE PRECISION,
    "coverage_vs_previous" DOUBLE PRECISION,
    "marketplace_publish_status" TEXT,
    "duration_ms" INTEGER,
    "summary_json" JSONB,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "supplier_scrape_quality_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "supplier_scrape_quality_runs_scrape_run_id_key"
    ON "public"."supplier_scrape_quality_runs"("scrape_run_id");

CREATE INDEX "supplier_scrape_quality_runs_supplier_key_created_at_idx"
    ON "public"."supplier_scrape_quality_runs"("supplier_key", "created_at" DESC);
