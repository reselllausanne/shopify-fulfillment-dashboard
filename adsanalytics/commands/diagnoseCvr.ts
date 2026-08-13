import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { Prisma } from "@prisma/client";

import { prisma } from "@/app/lib/prisma";
import { resolveAdsConfig } from "@/adsanalytics/config";
import { addDays, defaultEndDate } from "@/adsanalytics/dates";
import { searchAll, type GoogleAdsRow } from "@/adsanalytics/google/adsClient";
import {
  campaignConversionActionQuery,
  campaignDevicePerformanceQuery,
  conversionActionCatalogQuery,
  pmaxProductDataCvrQuery,
} from "@/adsanalytics/google/queries";
import { stringifySafe } from "@/adsanalytics/json";
import { log, withSyncRun } from "@/adsanalytics/run";

type Options = { days?: number };

type MetricAgg = {
  dim: string;
  clicks: number;
  conversions: number;
  value: number;
  cost: number;
};

function toRange(days: number, end: string) {
  return { start: addDays(end, -(days - 1)), end };
}

function cvr(conversions: number, clicks: number): number | null {
  if (clicks <= 0) return null;
  return Number(((conversions / clicks) * 100).toFixed(4));
}

function asString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v) || 0;
  return 0;
}

function section(row: GoogleAdsRow, name: string): Record<string, unknown> {
  const value = row[name];
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function compareDims(current: MetricAgg[], prior: MetricAgg[]) {
  const priorMap = new Map(prior.map((r) => [r.dim || "(empty)", r]));
  const dims = new Set([...current.map((r) => r.dim || "(empty)"), ...prior.map((r) => r.dim || "(empty)")]);
  const totalLostConversions = [...dims].reduce((sum, dim) => {
    const c = current.find((r) => (r.dim || "(empty)") === dim);
    const p = priorMap.get(dim);
    const delta = (c?.conversions ?? 0) - (p?.conversions ?? 0);
    return sum + (delta < 0 ? -delta : 0);
  }, 0);

  return [...dims]
    .map((dim) => {
      const c = current.find((r) => (r.dim || "(empty)") === dim) ?? {
        dim,
        clicks: 0,
        conversions: 0,
        value: 0,
        cost: 0,
      };
      const p = priorMap.get(dim) ?? { dim, clicks: 0, conversions: 0, value: 0, cost: 0 };
      const convDelta = c.conversions - p.conversions;
      const lostContribution = convDelta < 0 ? -convDelta : 0;
      return {
        dim,
        prior: {
          clicks: Number(p.clicks.toFixed(2)),
          conversions: Number(p.conversions.toFixed(2)),
          cvr: cvr(p.conversions, p.clicks),
          valueChf: Number(p.value.toFixed(2)),
        },
        current: {
          clicks: Number(c.clicks.toFixed(2)),
          conversions: Number(c.conversions.toFixed(2)),
          cvr: cvr(c.conversions, c.clicks),
          valueChf: Number(c.value.toFixed(2)),
        },
        clicksDelta: Number((c.clicks - p.clicks).toFixed(2)),
        conversionsDelta: Number(convDelta.toFixed(2)),
        cvrDeltaPp:
          cvr(c.conversions, c.clicks) != null && cvr(p.conversions, p.clicks) != null
            ? Number((cvr(c.conversions, c.clicks)! - cvr(p.conversions, p.clicks)!).toFixed(4))
            : null,
        lostConversionsContribution: Number(lostContribution.toFixed(2)),
        shareOfLostConversionsPct:
          totalLostConversions > 0
            ? Number(((lostContribution / totalLostConversions) * 100).toFixed(2))
            : 0,
      };
    })
    .sort((a, b) => b.lostConversionsContribution - a.lostConversionsContribution);
}

async function dbBreakdown(range: { start: string; end: string }, dimSql: Prisma.Sql): Promise<MetricAgg[]> {
  return prisma.$queryRaw<MetricAgg[]>(Prisma.sql`
    SELECT
      ${dimSql} AS dim,
      COALESCE(SUM("clicks"), 0)::float8 AS clicks,
      COALESCE(SUM("conversions"), 0)::float8 AS conversions,
      COALESCE(SUM("conversion_value"), 0)::float8 AS value,
      COALESCE(SUM("cost_micros"), 0)::float8 AS cost
    FROM "public"."ads_product_daily"
    WHERE "date" BETWEEN ${range.start}::date AND ${range.end}::date
    GROUP BY ${dimSql}
  `);
}

async function continuingModelBreakdown(
  current: { start: string; end: string },
  prior: { start: string; end: string }
): Promise<{ current: MetricAgg[]; prior: MetricAgg[] }> {
  const rows = await prisma.$queryRaw<
    Array<{
      period: string;
      clicks: number;
      conversions: number;
      value: number;
      cost: number;
    }>
  >(Prisma.sql`
    WITH cur AS (
      SELECT "shopify_product_id"::text AS id,
             SUM("clicks")::float8 AS clicks,
             SUM("conversions")::float8 AS conversions,
             SUM("conversion_value")::float8 AS value,
             SUM("cost_micros")::float8 AS cost
      FROM "public"."ads_product_daily"
      WHERE "date" BETWEEN ${current.start}::date AND ${current.end}::date
        AND "shopify_product_id" IS NOT NULL
      GROUP BY "shopify_product_id"
    ),
    pri AS (
      SELECT "shopify_product_id"::text AS id,
             SUM("clicks")::float8 AS clicks,
             SUM("conversions")::float8 AS conversions,
             SUM("conversion_value")::float8 AS value,
             SUM("cost_micros")::float8 AS cost
      FROM "public"."ads_product_daily"
      WHERE "date" BETWEEN ${prior.start}::date AND ${prior.end}::date
        AND "shopify_product_id" IS NOT NULL
      GROUP BY "shopify_product_id"
    ),
    cont AS (
      SELECT cur.id FROM cur INNER JOIN pri ON pri.id = cur.id
    )
    SELECT 'current'::text AS period,
           COALESCE(SUM(cur.clicks),0)::float8 AS clicks,
           COALESCE(SUM(cur.conversions),0)::float8 AS conversions,
           COALESCE(SUM(cur.value),0)::float8 AS value,
           COALESCE(SUM(cur.cost),0)::float8 AS cost
    FROM cur INNER JOIN cont ON cont.id = cur.id
    UNION ALL
    SELECT 'prior'::text AS period,
           COALESCE(SUM(pri.clicks),0)::float8 AS clicks,
           COALESCE(SUM(pri.conversions),0)::float8 AS conversions,
           COALESCE(SUM(pri.value),0)::float8 AS value,
           COALESCE(SUM(pri.cost),0)::float8 AS cost
    FROM pri INNER JOIN cont ON cont.id = pri.id
  `);

  const cur = rows.find((r) => r.period === "current");
  const pri = rows.find((r) => r.period === "prior");
  return {
    current: [
      {
        dim: "continuing_models",
        clicks: cur?.clicks ?? 0,
        conversions: cur?.conversions ?? 0,
        value: cur?.value ?? 0,
        cost: cur?.cost ?? 0,
      },
    ],
    prior: [
      {
        dim: "continuing_models",
        clicks: pri?.clicks ?? 0,
        conversions: pri?.conversions ?? 0,
        value: pri?.value ?? 0,
        cost: pri?.cost ?? 0,
      },
    ],
  };
}

function aggregateLive(
  rows: GoogleAdsRow[],
  dimFn: (row: GoogleAdsRow) => string
): MetricAgg[] {
  const map = new Map<string, MetricAgg>();
  for (const row of rows) {
    const metrics = section(row, "metrics");
    const dim = dimFn(row) || "(empty)";
    const existing = map.get(dim) ?? { dim, clicks: 0, conversions: 0, value: 0, cost: 0 };
    existing.clicks += num(metrics.clicks);
    existing.conversions += num(metrics.conversions);
    existing.value += num(metrics.conversionsValue);
    existing.cost += num(metrics.costMicros);
    map.set(dim, existing);
  }
  return [...map.values()];
}

async function shopifyOrderCount(range: { start: string; end: string }): Promise<{
  orders: number;
  totalSalesChf: number;
  netSalesChf: number;
}> {
  const rows = await prisma.$queryRaw<
    Array<{ orders: number; total_sales: number; net_sales: number }>
  >(Prisma.sql`
    SELECT
      COUNT(*)::int AS orders,
      COALESCE(SUM("totalSalesChf"), 0)::float8 AS total_sales,
      COALESCE(SUM(COALESCE("netSalesChf", "totalSalesChf")), 0)::float8 AS net_sales
    FROM "public"."ShopifyOrder"
    WHERE "createdAt" >= ${range.start}::timestamp
      AND "createdAt" < (${range.end}::date + INTERVAL '1 day')
      AND ("cancelledAt" IS NULL)
  `);
  const r = rows[0];
  return {
    orders: r?.orders ?? 0,
    totalSalesChf: Number((r?.total_sales ?? 0).toFixed(2)),
    netSalesChf: Number((r?.net_sales ?? 0).toFixed(2)),
  };
}

export async function diagnoseCvrCommand(options: Options = {}): Promise<number> {
  return withSyncRun("diagnose:cvr", options, async () => {
    const days = Math.max(7, Math.floor(options.days ?? 30));
    const end = defaultEndDate();
    const current = toRange(days, end);
    const prior = { start: addDays(current.start, -days), end: addDays(current.start, -1) };
    const config = resolveAdsConfig();

    const [
      campaignCur,
      campaignPrior,
      brandCur,
      brandPrior,
      langCur,
      langPrior,
      continuing,
      deviceCurRes,
      devicePriorRes,
      productDataCurRes,
      productDataPriorRes,
      convActionCurRes,
      convActionPriorRes,
      convCatalogRes,
      shopifyCur,
      shopifyPrior,
    ] = await Promise.all([
      dbBreakdown(current, Prisma.sql`COALESCE(NULLIF("campaign_name", ''), '(empty)')`),
      dbBreakdown(prior, Prisma.sql`COALESCE(NULLIF("campaign_name", ''), '(empty)')`),
      dbBreakdown(current, Prisma.sql`COALESCE(NULLIF("brand", ''), '(empty)')`),
      dbBreakdown(prior, Prisma.sql`COALESCE(NULLIF("brand", ''), '(empty)')`),
      dbBreakdown(current, Prisma.sql`COALESCE(NULLIF("language_code", ''), '(empty)')`),
      dbBreakdown(prior, Prisma.sql`COALESCE(NULLIF("language_code", ''), '(empty)')`),
      continuingModelBreakdown(current, prior),
      searchAll(config, campaignDevicePerformanceQuery(current.start, current.end)),
      searchAll(config, campaignDevicePerformanceQuery(prior.start, prior.end)),
      searchAll(config, pmaxProductDataCvrQuery(current.start, current.end)),
      searchAll(config, pmaxProductDataCvrQuery(prior.start, prior.end)),
      searchAll(config, campaignConversionActionQuery(current.start, current.end)),
      searchAll(config, campaignConversionActionQuery(prior.start, prior.end)),
      searchAll(config, conversionActionCatalogQuery()),
      shopifyOrderCount(current),
      shopifyOrderCount(prior),
    ]);

    const deviceCur = aggregateLive(deviceCurRes.rows, (row) => {
      const segments = section(row, "segments");
      return asString(segments.device);
    });
    const devicePrior = aggregateLive(devicePriorRes.rows, (row) => {
      const segments = section(row, "segments");
      return asString(segments.device);
    });

    const productDataCur = aggregateLive(productDataCurRes.rows, (row) => {
      const segments = section(row, "segments");
      const using = segments.adUsingProductData;
      return using === true || using === "true" ? "product_data" : "non_product_data";
    });
    const productDataPrior = aggregateLive(productDataPriorRes.rows, (row) => {
      const segments = section(row, "segments");
      const using = segments.adUsingProductData;
      return using === true || using === "true" ? "product_data" : "non_product_data";
    });

    const convActionCur = aggregateLive(convActionCurRes.rows, (row) => {
      const segments = section(row, "segments");
      return (
        asString(segments.conversionActionName) ||
        asString(segments.conversionAction) ||
        "(empty)"
      );
    });
    const convActionPrior = aggregateLive(convActionPriorRes.rows, (row) => {
      const segments = section(row, "segments");
      return (
        asString(segments.conversionActionName) ||
        asString(segments.conversionAction) ||
        "(empty)"
      );
    });

    const conversionActions = convCatalogRes.rows.map((row) => {
      const ca = section(row, "conversionAction");
      return {
        id: asString(ca.id),
        name: asString(ca.name),
        type: asString(ca.type),
        category: asString(ca.category),
        status: asString(ca.status),
        primaryForGoal: ca.primaryForGoal ?? null,
        countingType: asString(ca.countingType),
        includeInConversionsMetric: ca.includeInConversionsMetric ?? null,
      };
    });

    const purchaseLike = conversionActions.filter((a) => {
      const cat = a.category.toUpperCase();
      const name = a.name.toLowerCase();
      return (
        cat === "PURCHASE" ||
        name.includes("purchase") ||
        name.includes("achat") ||
        name.includes("commande") ||
        name.includes("order")
      );
    });
    const includedInConversions = conversionActions.filter(
      (a) => a.includeInConversionsMetric === true || a.includeInConversionsMetric === "true"
    );
    const nonPurchaseInConversions = includedInConversions.filter((a) => {
      const cat = a.category.toUpperCase();
      return cat !== "PURCHASE" && cat !== "";
    });

    const adsConvCur = campaignCur.reduce((s, r) => s + r.conversions, 0);
    const adsConvPrior = campaignPrior.reduce((s, r) => s + r.conversions, 0);
    const adsValueCur = campaignCur.reduce((s, r) => s + r.value, 0);
    const adsValuePrior = campaignPrior.reduce((s, r) => s + r.value, 0);

    const byCampaign = compareDims(campaignCur, campaignPrior);
    const byBrand = compareDims(brandCur, brandPrior);
    const byLanguage = compareDims(langCur, langPrior);
    const byDevice = compareDims(deviceCur, devicePrior);
    const byProductData = compareDims(productDataCur, productDataPrior);
    const byConversionAction = compareDims(convActionCur, convActionPrior);
    const byContinuing = compareDims(continuing.current, continuing.prior);

    const report = {
      periods: { current, prior },
      settings: { days, sourceNote: "DB product daily + live GAQL device/product-data/conversion_action" },
      conversionActionCatalog: {
        total: conversionActions.length,
        purchaseLike,
        includedInConversionsMetric: includedInConversions,
        nonPurchaseIncludedInConversions: nonPurchaseInConversions,
        purchaseOnlyConfirmed:
          nonPurchaseInConversions.length === 0 &&
          includedInConversions.every((a) => a.category.toUpperCase() === "PURCHASE"),
      },
      purchaseVsShopify: {
        note: "ShopifyOrder is account-level (all channels attribution), Google Ads conversions are ads-attributed. Compare orders of magnitude, not 1:1 equality.",
        current: {
          googleAdsConversions: Number(adsConvCur.toFixed(2)),
          googleAdsValueChf: Number(adsValueCur.toFixed(2)),
          shopifyOrders: shopifyCur.orders,
          shopifyTotalSalesChf: shopifyCur.totalSalesChf,
          shopifyNetSalesChf: shopifyCur.netSalesChf,
          adsConversionsVsShopifyOrdersRatio:
            shopifyCur.orders > 0 ? Number((adsConvCur / shopifyCur.orders).toFixed(3)) : null,
        },
        prior: {
          googleAdsConversions: Number(adsConvPrior.toFixed(2)),
          googleAdsValueChf: Number(adsValuePrior.toFixed(2)),
          shopifyOrders: shopifyPrior.orders,
          shopifyTotalSalesChf: shopifyPrior.totalSalesChf,
          shopifyNetSalesChf: shopifyPrior.netSalesChf,
          adsConversionsVsShopifyOrdersRatio:
            shopifyPrior.orders > 0 ? Number((adsConvPrior / shopifyPrior.orders).toFixed(3)) : null,
        },
      },
      decompositions: {
        campaign: byCampaign,
        device: byDevice,
        language: byLanguage,
        productDataVsNon: byProductData,
        conversionAction: byConversionAction,
        brand: byBrand,
        continuingModelsOnly: byContinuing,
      },
      topCvrDropSegments: {
        campaign: byCampaign.slice(0, 8),
        brand: byBrand.slice(0, 10),
        device: byDevice.slice(0, 5),
        productDataVsNon: byProductData,
        language: byLanguage,
        continuingModelsOnly: byContinuing,
      },
    };

    const outDir = path.join(process.cwd(), "tmp");
    await mkdir(outDir, { recursive: true });
    const outPath = path.join(outDir, `ads-diagnose-cvr-${current.start}_${current.end}.json`);
    await writeFile(outPath, stringifySafe(report), "utf8");

    log("diagnose_cvr.summary", {
      periods: report.periods,
      purchaseOnlyConfirmed: report.conversionActionCatalog.purchaseOnlyConfirmed,
      nonPurchaseInConversions: nonPurchaseInConversions.map((a) => a.name),
      purchaseVsShopify: report.purchaseVsShopify,
      topCampaignLostConv: byCampaign.slice(0, 5).map((r) => ({
        dim: r.dim,
        lost: r.lostConversionsContribution,
        cvrDeltaPp: r.cvrDeltaPp,
      })),
      continuing: byContinuing[0] ?? null,
      exportPath: outPath,
    });

    return report;
  });
}
