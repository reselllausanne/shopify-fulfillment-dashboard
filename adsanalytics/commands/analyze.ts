import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { Prisma } from "@prisma/client";

import { prisma } from "@/app/lib/prisma";
import { rangeForDays } from "@/adsanalytics/dates";
import { stringifySafe } from "@/adsanalytics/json";
import { log, withSyncRun } from "@/adsanalytics/run";

/**
 * Descriptive analysis only — no thresholds, no recommendations, no writes to
 * Google. Empty offer_ids are excluded from product segments and reported alone.
 */

const TOP_N = 25;

type ProductAggregate = {
  merchant_id: string;
  feed_label: string;
  language_code: string;
  offer_id: string;
  title: string;
  brand: string;
  shopify_product_id: string | null;
  shopify_variant_id: string | null;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  value: number;
  campaigns: number;
};

type CampaignAggregate = {
  campaign_id: string;
  campaign_name: string;
  channel_type: string;
  cost: number;
  conversions: number;
  value: number;
};

type EmptyOfferAggregate = {
  rows: number;
  cost: number;
  conversions: number;
  value: number;
};

type CustomAttrRow = {
  attr: string;
  value: string;
  rows: number;
  cost: number;
};

type DistinctCounts = {
  product_rows: number;
  distinct_offer_ids: number;
  distinct_shopify_products: number;
  distinct_shopify_variants: number;
};

function toChf(costMicros: number): number {
  return Number((costMicros / 1e6).toFixed(2));
}

function roas(value: number, costMicros: number): number | null {
  if (costMicros === 0) return null;
  return Number((value / (costMicros / 1e6)).toFixed(3));
}

function shapeProduct(row: ProductAggregate) {
  return {
    offerKey: `${row.merchant_id}|${row.feed_label}|${row.language_code}|${row.offer_id}`,
    offerId: row.offer_id,
    title: row.title,
    brand: row.brand,
    shopifyProductId: row.shopify_product_id,
    shopifyVariantId: row.shopify_variant_id,
    campaigns: row.campaigns,
    impressions: row.impressions,
    clicks: row.clicks,
    costChf: toChf(row.cost),
    conversions: Number(row.conversions.toFixed(2)),
    conversionValue: Number(row.value.toFixed(2)),
    roas: roas(row.value, row.cost),
  };
}

export async function analyzeCommand(options: { days: number; outDir?: string }): Promise<number> {
  return withSyncRun("analyze", { days: options.days }, async () => {
    const range = rangeForDays(options.days);
    const start = range.start;
    const end = range.end;

    // Product-level analysis excludes empty offer_ids.
    const products = await prisma.$queryRaw<ProductAggregate[]>(Prisma.sql`
      SELECT
        "merchant_id"::text AS merchant_id,
        "feed_label",
        "language_code",
        "offer_id",
        (ARRAY_AGG("title" ORDER BY "date" DESC))[1] AS title,
        (ARRAY_AGG("brand" ORDER BY "date" DESC))[1] AS brand,
        MAX("shopify_product_id")::text AS shopify_product_id,
        MAX("shopify_variant_id")::text AS shopify_variant_id,
        SUM("impressions")::float8 AS impressions,
        SUM("clicks")::float8 AS clicks,
        SUM("cost_micros")::float8 AS cost,
        SUM("conversions")::float8 AS conversions,
        SUM("conversion_value")::float8 AS value,
        COUNT(DISTINCT "campaign_id")::int AS campaigns
      FROM "public"."ads_product_daily"
      WHERE "date" BETWEEN ${start}::date AND ${end}::date
        AND "offer_id" <> ''
      GROUP BY "merchant_id", "feed_label", "language_code", "offer_id"
    `);

    const [emptyOffer] = await prisma.$queryRaw<EmptyOfferAggregate[]>(Prisma.sql`
      SELECT
        COUNT(*)::int AS rows,
        COALESCE(SUM("cost_micros"), 0)::float8 AS cost,
        COALESCE(SUM("conversions"), 0)::float8 AS conversions,
        COALESCE(SUM("conversion_value"), 0)::float8 AS value
      FROM "public"."ads_product_daily"
      WHERE "date" BETWEEN ${start}::date AND ${end}::date
        AND "offer_id" = ''
    `);

    const [distincts] = await prisma.$queryRaw<DistinctCounts[]>(Prisma.sql`
      SELECT
        COUNT(*)::int AS product_rows,
        COUNT(DISTINCT "offer_id") FILTER (WHERE "offer_id" <> '')::int AS distinct_offer_ids,
        COUNT(DISTINCT "shopify_product_id") FILTER (WHERE "shopify_product_id" IS NOT NULL)::int AS distinct_shopify_products,
        COUNT(DISTINCT "shopify_variant_id") FILTER (WHERE "shopify_variant_id" IS NOT NULL)::int AS distinct_shopify_variants
      FROM "public"."ads_product_daily"
      WHERE "date" BETWEEN ${start}::date AND ${end}::date
    `);

    const campaigns = await prisma.$queryRaw<CampaignAggregate[]>(Prisma.sql`
      SELECT
        "campaign_id"::text AS campaign_id,
        MAX("campaign_name") AS campaign_name,
        MAX("channel_type") AS channel_type,
        SUM("cost_micros")::float8 AS cost,
        SUM("conversions")::float8 AS conversions,
        SUM("conversion_value")::float8 AS value
      FROM "public"."ads_campaign_daily"
      WHERE "date" BETWEEN ${start}::date AND ${end}::date
      GROUP BY "campaign_id"
      ORDER BY cost DESC
    `);

    const customAttrRows = await prisma.$queryRaw<CustomAttrRow[]>(Prisma.sql`
      SELECT attr, value, COUNT(*)::int AS rows, COALESCE(SUM(cost), 0)::float8 AS cost
      FROM (
        SELECT 'customAttr0' AS attr, "custom_attr0" AS value, "cost_micros" AS cost
        FROM "public"."ads_product_daily"
        WHERE "date" BETWEEN ${start}::date AND ${end}::date AND "offer_id" <> ''
        UNION ALL
        SELECT 'customAttr1', "custom_attr1", "cost_micros"
        FROM "public"."ads_product_daily"
        WHERE "date" BETWEEN ${start}::date AND ${end}::date AND "offer_id" <> ''
        UNION ALL
        SELECT 'customAttr2', "custom_attr2", "cost_micros"
        FROM "public"."ads_product_daily"
        WHERE "date" BETWEEN ${start}::date AND ${end}::date AND "offer_id" <> ''
        UNION ALL
        SELECT 'customAttr3', "custom_attr3", "cost_micros"
        FROM "public"."ads_product_daily"
        WHERE "date" BETWEEN ${start}::date AND ${end}::date AND "offer_id" <> ''
        UNION ALL
        SELECT 'customAttr4', "custom_attr4", "cost_micros"
        FROM "public"."ads_product_daily"
        WHERE "date" BETWEEN ${start}::date AND ${end}::date AND "offer_id" <> ''
      ) t
      GROUP BY attr, value
      ORDER BY attr, cost DESC
    `);

    const customLabelDistribution: Record<
      string,
      Array<{ value: string; rows: number; costChf: number }>
    > = {};
    for (const row of customAttrRows) {
      const list = customLabelDistribution[row.attr] ?? [];
      if (list.length < 30) {
        list.push({
          value: row.value || "(empty)",
          rows: row.rows,
          costChf: toChf(row.cost),
        });
      }
      customLabelDistribution[row.attr] = list;
    }

    const totalCost = products.reduce((sum, row) => sum + row.cost, 0);

    const spendNoConversion = products.filter((row) => row.cost > 0 && row.conversions === 0);
    const withConversion = products.filter((row) => row.conversions > 0);
    const impressionsNoClick = products.filter((row) => row.impressions > 0 && row.clicks === 0);
    const clicksNoConversion = products.filter((row) => row.clicks > 0 && row.conversions === 0);

    const zeroConversionCost = spendNoConversion.reduce((sum, row) => sum + row.cost, 0);

    const byRoas = [...withConversion].sort(
      (a, b) => (roas(b.value, b.cost) ?? 0) - (roas(a.value, a.cost) ?? 0)
    );

    const summary = {
      range,
      totals: {
        productRows: distincts?.product_rows ?? 0,
        distinctOfferIds: distincts?.distinct_offer_ids ?? 0,
        distinctShopifyProducts: distincts?.distinct_shopify_products ?? 0,
        distinctShopifyVariants: distincts?.distinct_shopify_variants ?? 0,
        products: products.length,
        campaigns: campaigns.length,
        costChf: toChf(totalCost),
        conversions: Number(products.reduce((s, r) => s + r.conversions, 0).toFixed(2)),
        conversionValue: Number(products.reduce((s, r) => s + r.value, 0).toFixed(2)),
      },
      emptyOfferIds: {
        rows: emptyOffer?.rows ?? 0,
        costChf: toChf(emptyOffer?.cost ?? 0),
        conversions: Number((emptyOffer?.conversions ?? 0).toFixed(2)),
        conversionValue: Number((emptyOffer?.value ?? 0).toFixed(2)),
        note: "Excluded from product-level segments below.",
      },
      customLabelDistribution,
      spendWithoutConversion: {
        products: spendNoConversion.length,
        costChf: toChf(zeroConversionCost),
        shareOfProductSpendPct:
          totalCost > 0 ? Number(((zeroConversionCost / totalCost) * 100).toFixed(2)) : null,
        top: [...spendNoConversion]
          .sort((a, b) => b.cost - a.cost)
          .slice(0, TOP_N)
          .map(shapeProduct),
      },
      withConversions: {
        products: withConversion.length,
        costChf: toChf(withConversion.reduce((s, r) => s + r.cost, 0)),
        conversionValue: Number(withConversion.reduce((s, r) => s + r.value, 0).toFixed(2)),
        top: byRoas.slice(0, TOP_N).map(shapeProduct),
      },
      impressionsWithoutClicks: {
        products: impressionsNoClick.length,
        impressions: impressionsNoClick.reduce((s, r) => s + r.impressions, 0),
        top: [...impressionsNoClick]
          .sort((a, b) => b.impressions - a.impressions)
          .slice(0, TOP_N)
          .map(shapeProduct),
      },
      clicksWithoutConversions: {
        products: clicksNoConversion.length,
        clicks: clicksNoConversion.reduce((s, r) => s + r.clicks, 0),
        costChf: toChf(clicksNoConversion.reduce((s, r) => s + r.cost, 0)),
        top: [...clicksNoConversion]
          .sort((a, b) => b.cost - a.cost)
          .slice(0, TOP_N)
          .map(shapeProduct),
      },
      roasByProduct: {
        best: byRoas.slice(0, TOP_N).map(shapeProduct),
        worstWithSpend: [...products]
          .filter((row) => row.cost > 0)
          .sort((a, b) => (roas(a.value, a.cost) ?? 0) - (roas(b.value, b.cost) ?? 0))
          .slice(0, TOP_N)
          .map(shapeProduct),
      },
      roasByCampaign: campaigns.map((row) => ({
        campaignId: row.campaign_id,
        campaignName: row.campaign_name,
        channelType: row.channel_type,
        costChf: toChf(row.cost),
        conversions: Number(row.conversions.toFixed(2)),
        conversionValue: Number(row.value.toFixed(2)),
        roas: roas(row.value, row.cost),
      })),
    };

    const outDir = options.outDir ?? path.join(process.cwd(), "tmp");
    await mkdir(outDir, { recursive: true });
    const outFile = path.join(outDir, `ads-analyze-${range.end}-${options.days}d.json`);
    await writeFile(outFile, stringifySafe(summary, 2), "utf8");

    log("analyze.totals", summary.totals);
    log("analyze.empty_offer_ids", summary.emptyOfferIds);
    log("analyze.spend_without_conversion", {
      products: summary.spendWithoutConversion.products,
      costChf: summary.spendWithoutConversion.costChf,
      shareOfProductSpendPct: summary.spendWithoutConversion.shareOfProductSpendPct,
    });
    log("analyze.custom_labels", summary.customLabelDistribution);
    log("analyze.roas_by_campaign", { campaigns: summary.roasByCampaign });
    log("analyze.report_written", { file: outFile });

    return {
      ...summary.totals,
      emptyOfferCostChf: summary.emptyOfferIds.costChf,
      zeroConversionSpendChf: summary.spendWithoutConversion.costChf,
      zeroConversionSpendSharePct: summary.spendWithoutConversion.shareOfProductSpendPct,
      reportFile: outFile,
    };
  });
}
