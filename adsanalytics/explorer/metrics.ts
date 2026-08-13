import { Prisma } from "@prisma/client";

import { prisma } from "@/app/lib/prisma";

/**
 * Offer level Ads metrics live in ads_product_daily (keyed by offer_id, with
 * shopify_product_id parsed at ingestion). This module rolls them up to the model
 * grain used by the routing rules, and refuses to let decisions run on thin data.
 */

export type MetricWindow = { start: string; end: string };

export type MetricCoverage = {
  campaignId: string;
  window: MetricWindow;
  /** Impressions summed from the offer grain. */
  productImpressions: number;
  /** Impressions reported at campaign grain for the same window. */
  campaignImpressions: number;
  /** productImpressions / campaignImpressions, null when the campaign had no traffic. */
  impressionCoverage: number | null;
  /** Share of offer rows that resolved to a Shopify model id. */
  modelAttributionRate: number | null;
  offerRows: number;
  offerRowsWithModel: number;
  latestMetricDate: string | null;
  metricLagDays: number | null;
  lastBackfillAt: string | null;
  backfillAgeHours: number | null;
};

export type MetricGate = {
  pass: boolean;
  blockers: string[];
  warnings: string[];
  coverage: MetricCoverage;
  thresholds: MetricGateThresholds;
};

export type MetricGateThresholds = {
  minImpressionCoverage: number;
  minModelAttributionRate: number;
  maxMetricLagDays: number;
  maxBackfillAgeHours: number;
};

export const DEFAULT_METRIC_GATE_THRESHOLDS: MetricGateThresholds = {
  minImpressionCoverage: 0.8,
  minModelAttributionRate: 0.95,
  maxMetricLagDays: 2,
  maxBackfillAgeHours: 36,
};

export function loadMetricGateThresholds(
  overrides: Partial<MetricGateThresholds> = {},
  env: Record<string, string | undefined> = process.env
): MetricGateThresholds {
  const fromEnv = (key: string): number | undefined => {
    const raw = env[key];
    if (raw == null || raw.trim() === "") return undefined;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error(`Invalid ${key}=${raw}: expected a non-negative number`);
    }
    return parsed;
  };
  return {
    minImpressionCoverage:
      overrides.minImpressionCoverage ??
      fromEnv("ADS_EXPLORER_MIN_IMPRESSION_COVERAGE") ??
      DEFAULT_METRIC_GATE_THRESHOLDS.minImpressionCoverage,
    minModelAttributionRate:
      overrides.minModelAttributionRate ??
      fromEnv("ADS_EXPLORER_MIN_MODEL_ATTRIBUTION") ??
      DEFAULT_METRIC_GATE_THRESHOLDS.minModelAttributionRate,
    maxMetricLagDays:
      overrides.maxMetricLagDays ??
      fromEnv("ADS_EXPLORER_MAX_METRIC_LAG_DAYS") ??
      DEFAULT_METRIC_GATE_THRESHOLDS.maxMetricLagDays,
    maxBackfillAgeHours:
      overrides.maxBackfillAgeHours ??
      fromEnv("ADS_EXPLORER_MAX_BACKFILL_AGE_HOURS") ??
      DEFAULT_METRIC_GATE_THRESHOLDS.maxBackfillAgeHours,
  };
}

export type ModelMetricRollup = {
  shopifyProductId: string;
  impressions: number;
  clicks: number;
  costMicros: number;
  conversions: number;
  conversionValue: number;
};

async function aggregateModelMetrics(
  batchId: string,
  campaignId: string,
  window: MetricWindow
): Promise<ModelMetricRollup[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      shopify_product_id: string;
      impressions: number;
      clicks: number;
      cost_micros: number;
      conversions: number;
      conversion_value: number;
    }>
  >(Prisma.sql`
    SELECT
      pd."shopify_product_id"::text AS shopify_product_id,
      COALESCE(SUM(pd."impressions"), 0)::float8 AS impressions,
      COALESCE(SUM(pd."clicks"), 0)::float8 AS clicks,
      COALESCE(SUM(pd."cost_micros"), 0)::float8 AS cost_micros,
      COALESCE(SUM(pd."conversions"), 0)::float8 AS conversions,
      COALESCE(SUM(pd."conversion_value"), 0)::float8 AS conversion_value
    FROM "public"."ads_product_daily" pd
    JOIN "public"."ads_explorer_batch_models" bm
      ON bm."shopify_product_id" = pd."shopify_product_id"
     AND bm."batch_id" = ${batchId}
    WHERE pd."campaign_id" = ${campaignId}::bigint
      AND pd."date" >= ${window.start}::date
      AND pd."date" <= ${window.end}::date
      AND pd."shopify_product_id" IS NOT NULL
    GROUP BY pd."shopify_product_id"
  `);
  return rows.map((r) => ({
    shopifyProductId: r.shopify_product_id,
    impressions: r.impressions,
    clicks: r.clicks,
    costMicros: r.cost_micros,
    conversions: r.conversions,
    conversionValue: r.conversion_value,
  }));
}

async function writeModelMetrics(
  batchId: string,
  rollups: ModelMetricRollup[],
  scope: "explorer" | "long_tail"
): Promise<number> {
  if (rollups.length === 0) return 0;
  const chunkSize = 500;
  let written = 0;
  for (let i = 0; i < rollups.length; i += chunkSize) {
    const chunk = rollups.slice(i, i + chunkSize);
    const values = chunk.map(
      (r) => Prisma.sql`(
        ${r.shopifyProductId}::bigint,
        ${Math.round(r.impressions)}::bigint,
        ${Math.round(r.clicks)}::bigint,
        ${Math.round(r.costMicros)}::bigint,
        ${r.conversions}::numeric,
        ${r.conversionValue}::numeric
      )`
    );
    const source = Prisma.sql`(VALUES ${Prisma.join(values)}) AS v(
      shopify_product_id, impressions, clicks, cost_micros, conversions, conversion_value
    )`;
    const assignment =
      scope === "explorer"
        ? Prisma.sql`
            "impressions" = v.impressions,
            "clicks" = v.clicks,
            "cost_micros" = v.cost_micros,
            "conversions" = v.conversions,
            "conversion_value" = v.conversion_value
          `
        : Prisma.sql`
            "lt_impressions" = v.impressions,
            "lt_clicks" = v.clicks,
            "lt_cost_micros" = v.cost_micros,
            "lt_conversions" = v.conversions,
            "lt_conversion_value" = v.conversion_value
          `;
    written += await prisma.$executeRaw(Prisma.sql`
      UPDATE "public"."ads_explorer_batch_models" AS bm
      SET ${assignment},
        "metrics_synced_at" = CURRENT_TIMESTAMP,
        "updated_at" = CURRENT_TIMESTAMP
      FROM ${source}
      WHERE bm."batch_id" = ${batchId}
        AND bm."shopify_product_id" = v.shopify_product_id
    `);
  }
  return written;
}

async function resetModelMetrics(
  batchId: string,
  scope: "explorer" | "long_tail"
): Promise<void> {
  const assignment =
    scope === "explorer"
      ? Prisma.sql`
          "impressions" = 0,
          "clicks" = 0,
          "cost_micros" = 0,
          "conversions" = 0,
          "conversion_value" = 0
        `
      : Prisma.sql`
          "lt_impressions" = 0,
          "lt_clicks" = 0,
          "lt_cost_micros" = 0,
          "lt_conversions" = 0,
          "lt_conversion_value" = 0
        `;
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "public"."ads_explorer_batch_models"
    SET ${assignment}, "updated_at" = CURRENT_TIMESTAMP
    WHERE "batch_id" = ${batchId}
  `);
}

/**
 * Recompute model level metrics for one campaign scope from the offer grain.
 * Always a full recompute of the window, so re-running is safe and self healing.
 */
export async function syncBatchModelMetrics(
  batchId: string,
  campaignId: string,
  window: MetricWindow,
  scope: "explorer" | "long_tail"
): Promise<{ modelsWithMetrics: number; rowsWritten: number; totals: ModelMetricRollup }> {
  const rollups = await aggregateModelMetrics(batchId, campaignId, window);
  await resetModelMetrics(batchId, scope);
  const rowsWritten = await writeModelMetrics(batchId, rollups, scope);
  const totals = rollups.reduce<ModelMetricRollup>(
    (acc, r) => ({
      shopifyProductId: "total",
      impressions: acc.impressions + r.impressions,
      clicks: acc.clicks + r.clicks,
      costMicros: acc.costMicros + r.costMicros,
      conversions: acc.conversions + r.conversions,
      conversionValue: acc.conversionValue + r.conversionValue,
    }),
    {
      shopifyProductId: "total",
      impressions: 0,
      clicks: 0,
      costMicros: 0,
      conversions: 0,
      conversionValue: 0,
    }
  );
  return { modelsWithMetrics: rollups.length, rowsWritten, totals };
}

export async function assessMetricCoverage(
  campaignId: string,
  window: MetricWindow
): Promise<MetricCoverage> {
  const [productRows] = await prisma.$queryRaw<
    Array<{
      impressions: number;
      offer_rows: number;
      offer_rows_with_model: number;
      latest_date: string | null;
    }>
  >(Prisma.sql`
    SELECT
      COALESCE(SUM("impressions"), 0)::float8 AS impressions,
      COUNT(*)::int AS offer_rows,
      COUNT(*) FILTER (WHERE "shopify_product_id" IS NOT NULL)::int AS offer_rows_with_model,
      MAX("date")::text AS latest_date
    FROM "public"."ads_product_daily"
    WHERE "campaign_id" = ${campaignId}::bigint
      AND "date" >= ${window.start}::date
      AND "date" <= ${window.end}::date
  `);

  const [campaignRow] = await prisma.$queryRaw<Array<{ impressions: number }>>(Prisma.sql`
    SELECT COALESCE(SUM("impressions"), 0)::float8 AS impressions
    FROM "public"."ads_campaign_daily"
    WHERE "campaign_id" = ${campaignId}::bigint
      AND "date" >= ${window.start}::date
      AND "date" <= ${window.end}::date
  `);

  const [backfillRow] = await prisma.$queryRaw<Array<{ finished_at: string | null }>>(Prisma.sql`
    SELECT MAX("finished_at")::text AS finished_at
    FROM "public"."ads_sync_runs"
    WHERE "command" = 'backfill'
      AND "status" = 'succeeded'
  `);

  const productImpressions = productRows?.impressions ?? 0;
  const campaignImpressions = campaignRow?.impressions ?? 0;
  const offerRows = productRows?.offer_rows ?? 0;
  const offerRowsWithModel = productRows?.offer_rows_with_model ?? 0;
  const latestMetricDate = productRows?.latest_date ?? null;
  const lastBackfillAt = backfillRow?.finished_at ?? null;

  const now = Date.now();
  const metricLagDays = latestMetricDate
    ? Math.floor((now - new Date(`${latestMetricDate}T00:00:00Z`).getTime()) / 86_400_000)
    : null;
  const backfillAgeHours = lastBackfillAt
    ? (now - new Date(lastBackfillAt).getTime()) / 3_600_000
    : null;

  return {
    campaignId,
    window,
    productImpressions,
    campaignImpressions,
    impressionCoverage: campaignImpressions > 0 ? productImpressions / campaignImpressions : null,
    modelAttributionRate: offerRows > 0 ? offerRowsWithModel / offerRows : null,
    offerRows,
    offerRowsWithModel,
    latestMetricDate,
    metricLagDays,
    lastBackfillAt,
    backfillAgeHours,
  };
}

/**
 * Hard gate in front of every automatic routing decision. A failed nightly job or a
 * partial offer feed must never be read as "this model got no traffic".
 */
export function evaluateMetricGate(
  coverage: MetricCoverage,
  thresholds: MetricGateThresholds = DEFAULT_METRIC_GATE_THRESHOLDS
): MetricGate {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (coverage.lastBackfillAt == null) {
    blockers.push("No successful backfill run recorded: offer level metrics were never ingested");
  } else if (
    coverage.backfillAgeHours != null &&
    coverage.backfillAgeHours > thresholds.maxBackfillAgeHours
  ) {
    blockers.push(
      `Last successful backfill is ${coverage.backfillAgeHours.toFixed(1)}h old (limit ${thresholds.maxBackfillAgeHours}h)`
    );
  }

  if (coverage.campaignImpressions === 0 && coverage.productImpressions === 0) {
    warnings.push("Campaign recorded no impressions in the window; nothing to decide on yet");
  }

  if (coverage.latestMetricDate == null) {
    if (coverage.campaignImpressions > 0) {
      blockers.push("No offer level rows for this campaign while campaign level rows exist");
    }
  } else if (coverage.metricLagDays != null && coverage.metricLagDays > thresholds.maxMetricLagDays) {
    blockers.push(
      `Offer metrics stop at ${coverage.latestMetricDate} (${coverage.metricLagDays}d lag, limit ${thresholds.maxMetricLagDays}d)`
    );
  }

  if (
    coverage.impressionCoverage != null &&
    coverage.impressionCoverage < thresholds.minImpressionCoverage
  ) {
    blockers.push(
      `Offer grain covers ${(coverage.impressionCoverage * 100).toFixed(1)}% of campaign impressions (min ${(thresholds.minImpressionCoverage * 100).toFixed(0)}%)`
    );
  }

  if (
    coverage.modelAttributionRate != null &&
    coverage.modelAttributionRate < thresholds.minModelAttributionRate
  ) {
    blockers.push(
      `Only ${(coverage.modelAttributionRate * 100).toFixed(1)}% of offer rows resolve to a Shopify model (min ${(thresholds.minModelAttributionRate * 100).toFixed(0)}%)`
    );
  }

  return { pass: blockers.length === 0, blockers, warnings, coverage, thresholds };
}
