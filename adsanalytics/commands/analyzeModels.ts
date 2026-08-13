import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { Prisma } from "@prisma/client";

import { prisma } from "@/app/lib/prisma";
import {
  decisionRange,
  lagRange,
  resolveDateRange,
  type DateRange,
} from "@/adsanalytics/dates";
import { stringifySafe } from "@/adsanalytics/json";
import { log, withSyncRun } from "@/adsanalytics/run";

/**
 * Read-only model-level analysis (shopify_product_id).
 * Offer-level zero-conversion keys must NOT drive exclusions — aggregate here first.
 */

const CONVERSION_LAG_DAYS = 7;

const SPEND_COHORTS: Array<{ label: string; min: number; max: number | null }> = [
  { label: "CHF 0–2", min: 0, max: 2 },
  { label: "CHF 2–5", min: 2, max: 5 },
  { label: "CHF 5–10", min: 5, max: 10 },
  { label: "CHF 10–20", min: 10, max: 20 },
  { label: "CHF 20–40", min: 20, max: 40 },
  { label: "CHF 40–60", min: 40, max: 60 },
  { label: "CHF 60+", min: 60, max: null },
];

type ModelRow = {
  shopify_product_id: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  value: number;
  variant_count: number;
  language_count: number;
  campaign_count: number;
  first_impression: string | null;
  last_impression: string | null;
  first_click: string | null;
  last_click: string | null;
  title: string | null;
  brand: string | null;
};

type CampaignCoverage = {
  campaign_id: string;
  campaign_name: string;
  channel_type: string;
  cost_campaign: number;
  cost_product: number;
  conv_campaign: number;
  conv_product: number;
  value_campaign: number;
  value_product: number;
};

type LanguageRow = {
  language_code: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  value: number;
  models: number;
};

type CustomAttrRow = {
  attr: string;
  value: string;
  rows: number;
  cost: number;
};

type OverlapRow = {
  shopify_product_id: string;
  campaign_count: number;
  cost: number;
  value: number;
  conversions: number;
  campaigns: string;
  title: string | null;
};

function toChf(micros: number): number {
  return Number((micros / 1e6).toFixed(2));
}

function roas(value: number, costMicros: number): number | null {
  if (costMicros <= 0) return null;
  return Number((value / (costMicros / 1e6)).toFixed(3));
}

function cpc(costMicros: number, clicks: number): number | null {
  if (clicks <= 0) return null;
  return Number((costMicros / 1e6 / clicks).toFixed(3));
}

function ctr(clicks: number, impressions: number): number | null {
  if (impressions <= 0) return null;
  return Number(((clicks / impressions) * 100).toFixed(3));
}

function cvr(conversions: number, clicks: number): number | null {
  if (clicks <= 0) return null;
  return Number(((conversions / clicks) * 100).toFixed(3));
}

function avgConvValue(value: number, conversions: number): number | null {
  if (conversions <= 0) return null;
  return Number((value / conversions).toFixed(2));
}

async function loadModels(range: DateRange): Promise<ModelRow[]> {
  return prisma.$queryRaw<ModelRow[]>(Prisma.sql`
    SELECT
      "shopify_product_id"::text AS shopify_product_id,
      SUM("impressions")::float8 AS impressions,
      SUM("clicks")::float8 AS clicks,
      SUM("cost_micros")::float8 AS cost,
      SUM("conversions")::float8 AS conversions,
      SUM("conversion_value")::float8 AS value,
      COUNT(DISTINCT "shopify_variant_id")::int AS variant_count,
      COUNT(DISTINCT "language_code") FILTER (WHERE "language_code" <> '')::int AS language_count,
      COUNT(DISTINCT "campaign_id")::int AS campaign_count,
      MIN("date") FILTER (WHERE "impressions" > 0)::text AS first_impression,
      MAX("date") FILTER (WHERE "impressions" > 0)::text AS last_impression,
      MIN("date") FILTER (WHERE "clicks" > 0)::text AS first_click,
      MAX("date") FILTER (WHERE "clicks" > 0)::text AS last_click,
      (ARRAY_AGG("title" ORDER BY "date" DESC) FILTER (WHERE "title" <> ''))[1] AS title,
      (ARRAY_AGG("brand" ORDER BY "date" DESC) FILTER (WHERE "brand" <> ''))[1] AS brand
    FROM "public"."ads_product_daily"
    WHERE "date" BETWEEN ${range.start}::date AND ${range.end}::date
      AND "shopify_product_id" IS NOT NULL
      AND "offer_id" <> ''
    GROUP BY "shopify_product_id"
  `);
}

async function loadModelCostMap(range: DateRange): Promise<Map<string, { cost: number; conversions: number; value: number; clicks: number }>> {
  const rows = await prisma.$queryRaw<
    Array<{
      shopify_product_id: string;
      cost: number;
      conversions: number;
      value: number;
      clicks: number;
    }>
  >(Prisma.sql`
    SELECT
      "shopify_product_id"::text AS shopify_product_id,
      SUM("cost_micros")::float8 AS cost,
      SUM("conversions")::float8 AS conversions,
      SUM("conversion_value")::float8 AS value,
      SUM("clicks")::float8 AS clicks
    FROM "public"."ads_product_daily"
    WHERE "date" BETWEEN ${range.start}::date AND ${range.end}::date
      AND "shopify_product_id" IS NOT NULL
      AND "offer_id" <> ''
    GROUP BY "shopify_product_id"
  `);
  return new Map(rows.map((r) => [r.shopify_product_id, r]));
}

export type AnalyzeModelsOptions = {
  from?: string;
  to?: string;
  days?: number;
  outDir?: string;
};

export async function analyzeModelsCommand(options: AnalyzeModelsOptions): Promise<number> {
  return withSyncRun("analyze:models", { ...options }, async () => {
    const range = resolveDateRange(options);
    const decision = decisionRange(range, CONVERSION_LAG_DAYS);
    const lag = lagRange(range, CONVERSION_LAG_DAYS);

    const modelsFull = await loadModels(range);
    const modelsDecision = await loadModels(decision);
    const lagMap = lag ? await loadModelCostMap(lag) : new Map();

    const totalProductSpend = modelsFull.reduce((s, m) => s + m.cost, 0);
    const totalProductSpendDecision = modelsDecision.reduce((s, m) => s + m.cost, 0);

    // Zero-conversion cohorts on the lag-excluded decision window only.
    const zeroConvDecision = modelsDecision.filter((m) => m.conversions === 0 && m.cost > 0);

    const cohorts = SPEND_COHORTS.map((c) => {
      const members = zeroConvDecision.filter((m) => {
        const spend = m.cost / 1e6;
        return spend >= c.min && (c.max === null || spend < c.max);
      });
      const totalSpend = members.reduce((s, m) => s + m.cost, 0);
      const clicks = members.reduce((s, m) => s + m.clicks, 0);
      let laterConversions = 0;
      let laterValue = 0;
      for (const m of members) {
        const later = lagMap.get(m.shopify_product_id);
        if (later) {
          laterConversions += later.conversions;
          laterValue += later.value;
        }
      }
      return {
        cohort: c.label,
        modelCount: members.length,
        totalSpendChf: toChf(totalSpend),
        clicks,
        laterConversions: Number(laterConversions.toFixed(2)),
        laterConversionValue: Number(laterValue.toFixed(2)),
        pctOfProductSpend: totalProductSpendDecision > 0
          ? Number(((totalSpend / totalProductSpendDecision) * 100).toFixed(2))
          : null,
        pctOfFullPeriodProductSpend: totalProductSpend > 0
          ? Number(((totalSpend / totalProductSpend) * 100).toFixed(2))
          : null,
      };
    });

    const campaignCoverage = await prisma.$queryRaw<CampaignCoverage[]>(Prisma.sql`
      WITH prod AS (
        SELECT "date", "campaign_id",
               SUM("cost_micros")::float8 AS cost,
               SUM("conversions")::float8 AS conv,
               SUM("conversion_value")::float8 AS value
        FROM "public"."ads_product_daily"
        WHERE "date" BETWEEN ${range.start}::date AND ${range.end}::date
        GROUP BY 1, 2
      )
      SELECT
        c."campaign_id"::text AS campaign_id,
        MAX(c."campaign_name") AS campaign_name,
        MAX(c."channel_type") AS channel_type,
        COALESCE(SUM(c."cost_micros"), 0)::float8 AS cost_campaign,
        COALESCE(SUM(p.cost), 0)::float8 AS cost_product,
        COALESCE(SUM(c."conversions"), 0)::float8 AS conv_campaign,
        COALESCE(SUM(p.conv), 0)::float8 AS conv_product,
        COALESCE(SUM(c."conversion_value"), 0)::float8 AS value_campaign,
        COALESCE(SUM(p.value), 0)::float8 AS value_product
      FROM "public"."ads_campaign_daily" c
      LEFT JOIN prod p ON p."date" = c."date" AND p."campaign_id" = c."campaign_id"
      WHERE c."date" BETWEEN ${range.start}::date AND ${range.end}::date
      GROUP BY c."campaign_id"
      ORDER BY cost_campaign DESC
    `);

    const campaignCoverageShaped = campaignCoverage.map((c) => ({
      campaignId: c.campaign_id,
      campaignName: c.campaign_name,
      channelType: c.channel_type,
      costCampaignChf: toChf(c.cost_campaign),
      costProductChf: toChf(c.cost_product),
      uncoveredCostChf: toChf(c.cost_campaign - c.cost_product),
      costCoveragePct:
        c.cost_campaign > 0 ? Number(((c.cost_product / c.cost_campaign) * 100).toFixed(2)) : null,
      conversionsCampaign: Number(c.conv_campaign.toFixed(2)),
      conversionsProduct: Number(c.conv_product.toFixed(2)),
      uncoveredConversions: Number((c.conv_campaign - c.conv_product).toFixed(2)),
      valueCampaign: Number(c.value_campaign.toFixed(2)),
      valueProduct: Number(c.value_product.toFixed(2)),
      uncoveredValue: Number((c.value_campaign - c.value_product).toFixed(2)),
      campaignRoas: roas(c.value_campaign, c.cost_campaign),
      productAttributedRoas: roas(c.value_product, c.cost_product),
      focus: /vetements|lego/i.test(c.campaign_name),
    }));

    const overlap = await prisma.$queryRaw<OverlapRow[]>(Prisma.sql`
      SELECT
        "shopify_product_id"::text AS shopify_product_id,
        COUNT(DISTINCT "campaign_id")::int AS campaign_count,
        SUM("cost_micros")::float8 AS cost,
        SUM("conversion_value")::float8 AS value,
        SUM("conversions")::float8 AS conversions,
        STRING_AGG(DISTINCT "campaign_name", ' | ' ORDER BY "campaign_name") AS campaigns,
        (ARRAY_AGG("title" ORDER BY "date" DESC) FILTER (WHERE "title" <> ''))[1] AS title
      FROM "public"."ads_product_daily"
      WHERE "date" BETWEEN ${range.start}::date AND ${range.end}::date
        AND "shopify_product_id" IS NOT NULL
        AND "offer_id" <> ''
      GROUP BY "shopify_product_id"
      HAVING COUNT(DISTINCT "campaign_id") > 1
      ORDER BY SUM("cost_micros") DESC
    `);

    const byLanguage = await prisma.$queryRaw<LanguageRow[]>(Prisma.sql`
      SELECT
        "language_code",
        SUM("impressions")::float8 AS impressions,
        SUM("clicks")::float8 AS clicks,
        SUM("cost_micros")::float8 AS cost,
        SUM("conversions")::float8 AS conversions,
        SUM("conversion_value")::float8 AS value,
        COUNT(DISTINCT "shopify_product_id")::int AS models
      FROM "public"."ads_product_daily"
      WHERE "date" BETWEEN ${range.start}::date AND ${range.end}::date
        AND "offer_id" <> ''
      GROUP BY "language_code"
      ORDER BY cost DESC
    `);

    const customAttrRows = await prisma.$queryRaw<CustomAttrRow[]>(Prisma.sql`
      SELECT attr, value, COUNT(*)::int AS rows, COALESCE(SUM(cost), 0)::float8 AS cost
      FROM (
        SELECT 'customAttr0' AS attr, NULLIF("custom_attr0", '') AS value, "cost_micros" AS cost
        FROM "public"."ads_product_daily"
        WHERE "date" BETWEEN ${range.start}::date AND ${range.end}::date AND "offer_id" <> ''
        UNION ALL
        SELECT 'customAttr1', NULLIF("custom_attr1", ''), "cost_micros"
        FROM "public"."ads_product_daily"
        WHERE "date" BETWEEN ${range.start}::date AND ${range.end}::date AND "offer_id" <> ''
        UNION ALL
        SELECT 'customAttr2', NULLIF("custom_attr2", ''), "cost_micros"
        FROM "public"."ads_product_daily"
        WHERE "date" BETWEEN ${range.start}::date AND ${range.end}::date AND "offer_id" <> ''
        UNION ALL
        SELECT 'customAttr3', NULLIF("custom_attr3", ''), "cost_micros"
        FROM "public"."ads_product_daily"
        WHERE "date" BETWEEN ${range.start}::date AND ${range.end}::date AND "offer_id" <> ''
        UNION ALL
        SELECT 'customAttr4', NULLIF("custom_attr4", ''), "cost_micros"
        FROM "public"."ads_product_daily"
        WHERE "date" BETWEEN ${range.start}::date AND ${range.end}::date AND "offer_id" <> ''
      ) t
      GROUP BY attr, value
      ORDER BY attr, cost DESC NULLS LAST
    `);

    const customLabelDistribution: Record<
      string,
      Array<{ value: string; rows: number; costChf: number }>
    > = {};
    for (const row of customAttrRows) {
      const key = row.attr;
      const list = customLabelDistribution[key] ?? [];
      list.push({
        value: row.value ?? "(empty)",
        rows: row.rows,
        costChf: toChf(row.cost),
      });
      customLabelDistribution[key] = list;
    }

    const shapedModels = modelsFull
      .map((m) => ({
        shopifyProductId: m.shopify_product_id,
        title: m.title,
        brand: m.brand,
        impressions: m.impressions,
        clicks: m.clicks,
        spendChf: toChf(m.cost),
        conversions: Number(m.conversions.toFixed(2)),
        conversionValue: Number(m.value.toFixed(2)),
        roas: roas(m.value, m.cost),
        variantCount: m.variant_count,
        languageCount: m.language_count,
        campaignCount: m.campaign_count,
        firstImpression: m.first_impression,
        lastImpression: m.last_impression,
        firstClick: m.first_click,
        lastClick: m.last_click,
      }))
      .sort((a, b) => b.spendChf - a.spendChf);

    const zeroConvSpendDecision = zeroConvDecision.reduce((s, m) => s + m.cost, 0);

    const summary = {
      note: "Offer-level zero-conversion keys must NOT be used for exclusions. Use model cohorts on the lag-excluded decision window.",
      range,
      decisionWindow: decision,
      lagWindow: lag,
      conversionLagDays: CONVERSION_LAG_DAYS,
      totals: {
        models: modelsFull.length,
        impressions: modelsFull.reduce((s, m) => s + m.impressions, 0),
        clicks: modelsFull.reduce((s, m) => s + m.clicks, 0),
        spendChf: toChf(totalProductSpend),
        conversions: Number(modelsFull.reduce((s, m) => s + m.conversions, 0).toFixed(2)),
        conversionValue: Number(modelsFull.reduce((s, m) => s + m.value, 0).toFixed(2)),
        roas: roas(
          modelsFull.reduce((s, m) => s + m.value, 0),
          totalProductSpend
        ),
        cpc: cpc(totalProductSpend, modelsFull.reduce((s, m) => s + m.clicks, 0)),
        ctr: ctr(
          modelsFull.reduce((s, m) => s + m.clicks, 0),
          modelsFull.reduce((s, m) => s + m.impressions, 0)
        ),
        conversionRate: cvr(
          modelsFull.reduce((s, m) => s + m.conversions, 0),
          modelsFull.reduce((s, m) => s + m.clicks, 0)
        ),
        avgConversionValue: avgConvValue(
          modelsFull.reduce((s, m) => s + m.value, 0),
          modelsFull.reduce((s, m) => s + m.conversions, 0)
        ),
      },
      zeroConversionModelsDecisionWindow: {
        modelCount: zeroConvDecision.length,
        spendChf: toChf(zeroConvSpendDecision),
        avgSpendChf:
          zeroConvDecision.length > 0
            ? Number((zeroConvSpendDecision / 1e6 / zeroConvDecision.length).toFixed(2))
            : null,
        pctOfDecisionWindowSpend:
          totalProductSpendDecision > 0
            ? Number(((zeroConvSpendDecision / totalProductSpendDecision) * 100).toFixed(2))
            : null,
        cohorts,
      },
      campaignCoverage: campaignCoverageShaped,
      focusCampaigns: campaignCoverageShaped.filter((c) => c.focus),
      multiCampaignModels: {
        modelCount: overlap.length,
        spendChf: toChf(overlap.reduce((s, r) => s + r.cost, 0)),
        conversionValue: Number(overlap.reduce((s, r) => s + r.value, 0).toFixed(2)),
        conversions: Number(overlap.reduce((s, r) => s + r.conversions, 0).toFixed(2)),
        top: overlap.slice(0, 50).map((r) => ({
          shopifyProductId: r.shopify_product_id,
          title: r.title,
          campaignCount: r.campaign_count,
          campaigns: r.campaigns,
          spendChf: toChf(r.cost),
          conversionValue: Number(r.value.toFixed(2)),
          conversions: Number(r.conversions.toFixed(2)),
          roas: roas(r.value, r.cost),
        })),
      },
      byLanguage: byLanguage.map((r) => ({
        language: r.language_code || "(empty)",
        models: r.models,
        impressions: r.impressions,
        clicks: r.clicks,
        spendChf: toChf(r.cost),
        conversions: Number(r.conversions.toFixed(2)),
        conversionValue: Number(r.value.toFixed(2)),
        roas: roas(r.value, r.cost),
        cpc: cpc(r.cost, r.clicks),
        ctr: ctr(r.clicks, r.impressions),
      })),
      customLabelDistribution,
      topModelsBySpend: shapedModels.slice(0, 50),
      topModelsByRoas: [...shapedModels]
        .filter((m) => m.conversions > 0 && m.spendChf > 0)
        .sort((a, b) => (b.roas ?? 0) - (a.roas ?? 0))
        .slice(0, 50),
    };

    const outDir = options.outDir ?? path.join(process.cwd(), "tmp");
    await mkdir(outDir, { recursive: true });
    const outFile = path.join(outDir, `ads-models-${range.start}_${range.end}.json`);
    await writeFile(outFile, stringifySafe(summary, 2), "utf8");

    log("analyze.models.totals", summary.totals);
    log("analyze.models.zero_conv_cohorts", summary.zeroConversionModelsDecisionWindow);
    log("analyze.models.focus_campaigns", { campaigns: summary.focusCampaigns });
    log("analyze.models.multi_campaign", {
      modelCount: summary.multiCampaignModels.modelCount,
      spendChf: summary.multiCampaignModels.spendChf,
    });
    log("analyze.models.by_language", { languages: summary.byLanguage });
    log("analyze.models.report_written", { file: outFile });

    return {
      models: summary.totals.models,
      spendChf: summary.totals.spendChf,
      zeroConvModels: summary.zeroConversionModelsDecisionWindow.modelCount,
      zeroConvSpendChf: summary.zeroConversionModelsDecisionWindow.spendChf,
      reportFile: outFile,
    };
  });
}

/** Period totals used by the comparison report (no file write). */
export async function periodSnapshot(range: DateRange) {
  const modelsFull = await loadModels(range);
  const decision = decisionRange(range, CONVERSION_LAG_DAYS);
  const modelsDecision = await loadModels(decision);
  const totalCost = modelsFull.reduce((s, m) => s + m.cost, 0);
  const totalValue = modelsFull.reduce((s, m) => s + m.value, 0);
  const totalClicks = modelsFull.reduce((s, m) => s + m.clicks, 0);
  const totalImpr = modelsFull.reduce((s, m) => s + m.impressions, 0);
  const totalConv = modelsFull.reduce((s, m) => s + m.conversions, 0);

  const zeroConv = modelsDecision.filter((m) => m.conversions === 0 && m.cost > 0);
  const cohorts = SPEND_COHORTS.map((c) => {
    const members = zeroConv.filter((m) => {
      const spend = m.cost / 1e6;
      return spend >= c.min && (c.max === null || spend < c.max);
    });
    const spend = members.reduce((s, m) => s + m.cost, 0);
    return {
      cohort: c.label,
      modelCount: members.length,
      spendChf: toChf(spend),
    };
  });

  const coverage = await prisma.$queryRaw<
    Array<{
      cost_campaign: number;
      cost_product: number;
      value_campaign: number;
      value_product: number;
      conv_campaign: number;
      conv_product: number;
    }>
  >(Prisma.sql`
    WITH prod AS (
      SELECT "date", "campaign_id",
             SUM("cost_micros")::float8 AS cost,
             SUM("conversions")::float8 AS conv,
             SUM("conversion_value")::float8 AS value
      FROM "public"."ads_product_daily"
      WHERE "date" BETWEEN ${range.start}::date AND ${range.end}::date
      GROUP BY 1, 2
    )
    SELECT
      COALESCE(SUM(c."cost_micros"), 0)::float8 AS cost_campaign,
      COALESCE(SUM(p.cost), 0)::float8 AS cost_product,
      COALESCE(SUM(c."conversion_value"), 0)::float8 AS value_campaign,
      COALESCE(SUM(p.value), 0)::float8 AS value_product,
      COALESCE(SUM(c."conversions"), 0)::float8 AS conv_campaign,
      COALESCE(SUM(p.conv), 0)::float8 AS conv_product
    FROM "public"."ads_campaign_daily" c
    LEFT JOIN prod p ON p."date" = c."date" AND p."campaign_id" = c."campaign_id"
    WHERE c."date" BETWEEN ${range.start}::date AND ${range.end}::date
  `);

  const byCampaign = await prisma.$queryRaw<CampaignCoverage[]>(Prisma.sql`
    WITH prod AS (
      SELECT "date", "campaign_id",
             SUM("cost_micros")::float8 AS cost,
             SUM("conversions")::float8 AS conv,
             SUM("conversion_value")::float8 AS value
      FROM "public"."ads_product_daily"
      WHERE "date" BETWEEN ${range.start}::date AND ${range.end}::date
      GROUP BY 1, 2
    )
    SELECT
      c."campaign_id"::text AS campaign_id,
      MAX(c."campaign_name") AS campaign_name,
      MAX(c."channel_type") AS channel_type,
      COALESCE(SUM(c."cost_micros"), 0)::float8 AS cost_campaign,
      COALESCE(SUM(p.cost), 0)::float8 AS cost_product,
      COALESCE(SUM(c."conversions"), 0)::float8 AS conv_campaign,
      COALESCE(SUM(p.conv), 0)::float8 AS conv_product,
      COALESCE(SUM(c."conversion_value"), 0)::float8 AS value_campaign,
      COALESCE(SUM(p.value), 0)::float8 AS value_product
    FROM "public"."ads_campaign_daily" c
    LEFT JOIN prod p ON p."date" = c."date" AND p."campaign_id" = c."campaign_id"
    WHERE c."date" BETWEEN ${range.start}::date AND ${range.end}::date
    GROUP BY c."campaign_id"
    ORDER BY cost_campaign DESC
  `);

  const byLanguage = await prisma.$queryRaw<LanguageRow[]>(Prisma.sql`
    SELECT
      "language_code",
      SUM("impressions")::float8 AS impressions,
      SUM("clicks")::float8 AS clicks,
      SUM("cost_micros")::float8 AS cost,
      SUM("conversions")::float8 AS conversions,
      SUM("conversion_value")::float8 AS value,
      COUNT(DISTINCT "shopify_product_id")::int AS models
    FROM "public"."ads_product_daily"
    WHERE "date" BETWEEN ${range.start}::date AND ${range.end}::date
      AND "offer_id" <> ''
    GROUP BY "language_code"
    ORDER BY cost DESC
  `);

  const cov = coverage[0] ?? {
    cost_campaign: 0,
    cost_product: 0,
    value_campaign: 0,
    value_product: 0,
    conv_campaign: 0,
    conv_product: 0,
  };

  const uncoveredCost = cov.cost_campaign - cov.cost_product;
  const uncoveredValue = cov.value_campaign - cov.value_product;
  const uncoveredConv = cov.conv_campaign - cov.conv_product;

  const totalCampaign = {
    spendChf: toChf(cov.cost_campaign),
    valueChf: Number(cov.value_campaign.toFixed(2)),
    conversions: Number(cov.conv_campaign.toFixed(2)),
    roas: roas(cov.value_campaign, cov.cost_campaign),
  };
  const productAttributed = {
    spendChf: toChf(cov.cost_product),
    valueChf: Number(cov.value_product.toFixed(2)),
    conversions: Number(cov.conv_product.toFixed(2)),
    roas: roas(cov.value_product, cov.cost_product),
    impressions: totalImpr,
    clicks: totalClicks,
    distinctShopifyModels: modelsFull.length,
    cpc: cpc(totalCost, totalClicks),
    ctr: ctr(totalClicks, totalImpr),
    conversionRate: cvr(totalConv, totalClicks),
    avgConversionValue: avgConvValue(totalValue, totalConv),
  };
  const uncovered = {
    spendChf: toChf(uncoveredCost),
    valueChf: Number(uncoveredValue.toFixed(2)),
    conversions: Number(uncoveredConv.toFixed(2)),
    roas: roas(uncoveredValue, uncoveredCost),
  };

  return {
    range,
    decisionWindow: decision,
    /** Always prefer these three layers — do not treat product-attributed as overall. */
    totalCampaign,
    productAttributed,
    uncovered,
    // Backward-compat aliases (product-attributed). Prefer totalCampaign / productAttributed / uncovered.
    spendChf: productAttributed.spendChf,
    revenueChf: productAttributed.valueChf,
    roas: productAttributed.roas,
    impressions: totalImpr,
    clicks: totalClicks,
    cpc: productAttributed.cpc,
    ctr: productAttributed.ctr,
    conversionRate: productAttributed.conversionRate,
    conversions: productAttributed.conversions,
    avgConversionValue: productAttributed.avgConversionValue,
    distinctShopifyModels: modelsFull.length,
    zeroConversionCohorts: cohorts,
    zeroConversionSpendChf: toChf(zeroConv.reduce((s, m) => s + m.cost, 0)),
    uncoveredSpendChf: uncovered.spendChf,
    campaignSpendChf: totalCampaign.spendChf,
    productAttributedSpendChf: productAttributed.spendChf,
    byCampaign: byCampaign.map((c) => {
      const uCost = c.cost_campaign - c.cost_product;
      const uValue = c.value_campaign - c.value_product;
      return {
        campaignId: c.campaign_id,
        campaignName: c.campaign_name,
        channelType: c.channel_type,
        totalCampaign: {
          spendChf: toChf(c.cost_campaign),
          valueChf: Number(c.value_campaign.toFixed(2)),
          conversions: Number(c.conv_campaign.toFixed(2)),
          roas: roas(c.value_campaign, c.cost_campaign),
        },
        productAttributed: {
          spendChf: toChf(c.cost_product),
          valueChf: Number(c.value_product.toFixed(2)),
          conversions: Number(c.conv_product.toFixed(2)),
          roas: roas(c.value_product, c.cost_product),
        },
        uncovered: {
          spendChf: toChf(uCost),
          valueChf: Number(uValue.toFixed(2)),
          conversions: Number((c.conv_campaign - c.conv_product).toFixed(2)),
          roas: roas(uValue, uCost),
        },
        // legacy flat fields
        costCampaignChf: toChf(c.cost_campaign),
        costProductChf: toChf(c.cost_product),
        uncoveredCostChf: toChf(uCost),
        campaignRoas: roas(c.value_campaign, c.cost_campaign),
        productRoas: roas(c.value_product, c.cost_product),
        conversionsCampaign: Number(c.conv_campaign.toFixed(2)),
        conversionsProduct: Number(c.conv_product.toFixed(2)),
        valueCampaign: Number(c.value_campaign.toFixed(2)),
        valueProduct: Number(c.value_product.toFixed(2)),
      };
    }),
    byLanguage: byLanguage.map((r) => ({
      language: r.language_code || "(empty)",
      models: r.models,
      spendChf: toChf(r.cost),
      revenueChf: Number(r.value.toFixed(2)),
      roas: roas(r.value, r.cost),
      impressions: r.impressions,
      clicks: r.clicks,
    })),
  };
}
