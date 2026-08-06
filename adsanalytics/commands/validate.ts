import { Prisma } from "@prisma/client";

import { prisma } from "@/app/lib/prisma";
import { rangeForDays } from "@/adsanalytics/dates";
import { log, withSyncRun } from "@/adsanalytics/run";

/**
 * Diagnostic only.
 *
 * Product-level rows are never expected to add up to campaign totals: Performance
 * Max serves inventory that is not tied to a Shopping product, and that traffic
 * simply does not exist in shopping_performance_view. So this command reports
 * coverage and points at what explains the gap — it never fails the POC because
 * coverage is below 100%.
 */

type CoverageRow = {
  cost_campaign: number;
  cost_product: number;
  conv_campaign: number;
  conv_product: number;
  value_campaign: number;
  value_product: number;
};

type CampaignCoverageRow = CoverageRow & {
  campaign_id: string;
  campaign_name: string;
  channel_type: string;
};

type MonthCoverageRow = CoverageRow & { month: string };

function ratio(product: number, campaign: number): number | null {
  if (campaign === 0) return null;
  return Number(((product / campaign) * 100).toFixed(2));
}

function withRatios<T extends CoverageRow>(row: T) {
  return {
    ...row,
    costChfCampaign: Number((row.cost_campaign / 1e6).toFixed(2)),
    costChfProduct: Number((row.cost_product / 1e6).toFixed(2)),
    costCoveragePct: ratio(row.cost_product, row.cost_campaign),
    conversionCoveragePct: ratio(row.conv_product, row.conv_campaign),
    valueCoveragePct: ratio(row.value_product, row.value_campaign),
    uncoveredCostChf: Number(((row.cost_campaign - row.cost_product) / 1e6).toFixed(2)),
  };
}

export async function validateCommand(options: { days: number }): Promise<number> {
  return withSyncRun("validate", { days: options.days }, async () => {
    const range = rangeForDays(options.days);
    const start = range.start;
    const end = range.end;

    const productTotals = Prisma.sql`
      SELECT "date", "campaign_id",
             SUM("cost_micros")::float8 AS cost,
             SUM("conversions")::float8 AS conv,
             SUM("conversion_value")::float8 AS value
      FROM "public"."ads_product_daily"
      WHERE "date" BETWEEN ${start}::date AND ${end}::date
      GROUP BY 1, 2
    `;

    const [overall] = await prisma.$queryRaw<CoverageRow[]>(Prisma.sql`
      WITH prod AS (${productTotals})
      SELECT
        COALESCE(SUM(c."cost_micros"), 0)::float8 AS cost_campaign,
        COALESCE(SUM(p.cost), 0)::float8 AS cost_product,
        COALESCE(SUM(c."conversions"), 0)::float8 AS conv_campaign,
        COALESCE(SUM(p.conv), 0)::float8 AS conv_product,
        COALESCE(SUM(c."conversion_value"), 0)::float8 AS value_campaign,
        COALESCE(SUM(p.value), 0)::float8 AS value_product
      FROM "public"."ads_campaign_daily" c
      LEFT JOIN prod p ON p."date" = c."date" AND p."campaign_id" = c."campaign_id"
      WHERE c."date" BETWEEN ${start}::date AND ${end}::date
    `);

    const byCampaign = await prisma.$queryRaw<CampaignCoverageRow[]>(Prisma.sql`
      WITH prod AS (${productTotals})
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
      WHERE c."date" BETWEEN ${start}::date AND ${end}::date
      GROUP BY c."campaign_id"
      ORDER BY cost_campaign DESC
    `);

    const byMonth = await prisma.$queryRaw<MonthCoverageRow[]>(Prisma.sql`
      WITH prod AS (${productTotals})
      SELECT
        to_char(c."date", 'YYYY-MM') AS month,
        COALESCE(SUM(c."cost_micros"), 0)::float8 AS cost_campaign,
        COALESCE(SUM(p.cost), 0)::float8 AS cost_product,
        COALESCE(SUM(c."conversions"), 0)::float8 AS conv_campaign,
        COALESCE(SUM(p.conv), 0)::float8 AS conv_product,
        COALESCE(SUM(c."conversion_value"), 0)::float8 AS value_campaign,
        COALESCE(SUM(p.value), 0)::float8 AS value_product
      FROM "public"."ads_campaign_daily" c
      LEFT JOIN prod p ON p."date" = c."date" AND p."campaign_id" = c."campaign_id"
      WHERE c."date" BETWEEN ${start}::date AND ${end}::date
      GROUP BY 1
      ORDER BY 1
    `);

    const summary = {
      range,
      overall: overall ? withRatios(overall) : null,
      byCampaign: byCampaign.map(withRatios),
      byMonth: byMonth.map(withRatios),
      note: "Coverage below 100% is expected: Performance Max inventory not tied to a Shopping product never appears in shopping_performance_view.",
    };

    log("validate.overall", summary.overall ?? {});
    for (const row of summary.byCampaign) {
      log("validate.campaign", {
        campaignId: row.campaign_id,
        campaignName: row.campaign_name,
        channelType: row.channel_type,
        costChfCampaign: row.costChfCampaign,
        costCoveragePct: row.costCoveragePct,
        conversionCoveragePct: row.conversionCoveragePct,
        valueCoveragePct: row.valueCoveragePct,
        uncoveredCostChf: row.uncoveredCostChf,
      });
    }
    for (const row of summary.byMonth) {
      log("validate.month", {
        month: row.month,
        costChfCampaign: row.costChfCampaign,
        costCoveragePct: row.costCoveragePct,
        uncoveredCostChf: row.uncoveredCostChf,
      });
    }

    const worstCampaigns = [...summary.byCampaign]
      .filter((row) => row.cost_campaign > 0)
      .sort((a, b) => b.uncoveredCostChf - a.uncoveredCostChf)
      .slice(0, 5);
    log("validate.largest_gaps", { campaigns: worstCampaigns });

    return summary;
  });
}
