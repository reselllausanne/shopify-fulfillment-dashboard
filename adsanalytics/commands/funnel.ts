import { Prisma } from "@prisma/client";

import { prisma } from "@/app/lib/prisma";
import { addDays, defaultEndDate, type DateRange } from "@/adsanalytics/dates";
import { log, withSyncRun } from "@/adsanalytics/run";

const DEFAULT_GROSS_MARGIN = 0.3035;
const TARGET_ROAS = 5.0;
const BREAK_EVEN_ROAS = Number((1 / DEFAULT_GROSS_MARGIN).toFixed(3));

export type FunnelGranularity = "offer" | "variant" | "model";

export type FunnelCommandOptions = {
  days?: number;
  granularity?: FunnelGranularity;
};

type InventoryOffer = {
  merchant_id: string;
  channel: string;
  language_code: string;
  feed_label: string;
  offer_id: string;
  shopify_product_id: string | null;
  shopify_variant_id: string | null;
  targeted_campaign_ids: string[];
  brand: string;
  custom_attr0: string;
  custom_attr1: string;
  product_type: string;
};

type OfferPerf = {
  merchant_id: string;
  channel: string;
  language_code: string;
  feed_label: string;
  offer_id: string;
  impressions: number;
  clicks: number;
  cost_micros: number;
  conversions: number;
  conversion_value: number;
  impressions_7d: number;
  clicks_7d: number;
  conversions_lifetime: number;
};

type EntityRow = {
  key: string;
  unmapped: boolean;
  targeted: boolean;
  impressions: number;
  clicks: number;
  costMicros: number;
  conversions: number;
  conversionValue: number;
  impressions7d: number;
  clicks7d: number;
  conversionsLifetime: number;
  brand: string;
  customAttr0: string;
  customAttr1: string;
  productType: string;
};

type StepShape = {
  step: string;
  count: number;
  pctOfPrevious: number | null;
  pctOfTotal: number | null;
  impressions: number;
  clicks: number;
  spendChf: number;
  conversions: number;
  valueChf: number;
  roas: number | null;
};

function toRange(days: number, end: string): DateRange {
  return { start: addDays(end, -(days - 1)), end };
}

function parseGranularity(value: string | undefined): FunnelGranularity {
  if (value === "offer" || value === "variant" || value === "model") return value;
  return "model";
}

function roas(value: number, costMicros: number): number | null {
  if (costMicros <= 0) return null;
  return Number((value / (costMicros / 1e6)).toFixed(3));
}

function ctr(clicks: number, impressions: number): number | null {
  if (impressions <= 0) return null;
  return Number(((clicks / impressions) * 100).toFixed(3));
}

function cpc(costMicros: number, clicks: number): number | null {
  if (clicks <= 0) return null;
  return Number((costMicros / 1e6 / clicks).toFixed(3));
}

function cvr(conversions: number, clicks: number): number | null {
  if (clicks <= 0) return null;
  return Number(((conversions / clicks) * 100).toFixed(3));
}

function aov(value: number, conversions: number): number | null {
  if (conversions <= 0) return null;
  return Number((value / conversions).toFixed(2));
}

function toChf(micros: number): number {
  return Number((micros / 1e6).toFixed(2));
}

function offerKey(input: {
  merchant_id: string;
  channel: string;
  language_code: string;
  feed_label: string;
  offer_id: string;
}): string {
  return [
    input.merchant_id,
    input.channel.toLowerCase(),
    input.language_code.toLowerCase(),
    input.feed_label.toLowerCase(),
    input.offer_id.toLowerCase(),
  ].join("|");
}

function entityKey(granularity: FunnelGranularity, row: InventoryOffer): { key: string; unmapped: boolean } {
  if (granularity === "offer") {
    return {
      key: offerKey(row),
      unmapped: !/^shopify_[a-z]{2}_\d+(?:_\d+)?$/i.test(row.offer_id),
    };
  }
  if (granularity === "variant") {
    if (row.shopify_variant_id) return { key: row.shopify_variant_id, unmapped: false };
    return { key: `unmapped:${offerKey(row)}`, unmapped: true };
  }
  if (row.shopify_product_id) return { key: row.shopify_product_id, unmapped: false };
  return { key: `unmapped:${offerKey(row)}`, unmapped: true };
}

async function loadInventoryOffers(): Promise<InventoryOffer[]> {
  return prisma.$queryRaw<InventoryOffer[]>(Prisma.sql`
    SELECT
      "merchant_id"::text,
      "channel",
      "language_code",
      "feed_label",
      "offer_id",
      "shopify_product_id"::text,
      "shopify_variant_id"::text,
      "targeted_campaign_ids",
      COALESCE("brand", '') AS brand,
      COALESCE("custom_attr0", '') AS custom_attr0,
      COALESCE("custom_attr1", '') AS custom_attr1,
      COALESCE("product_type", '') AS product_type
    FROM "public"."ads_shopping_product_current"
    WHERE "is_current" = true
  `);
}

async function loadOfferPerf(range: DateRange): Promise<OfferPerf[]> {
  const last7Start = addDays(range.end, -6);
  return prisma.$queryRaw<OfferPerf[]>(Prisma.sql`
    WITH date_range AS (
      SELECT
        "merchant_id"::text AS merchant_id,
        'ONLINE'::text AS channel,
        "language_code",
        "feed_label",
        "offer_id",
        SUM("impressions")::float8 AS impressions,
        SUM("clicks")::float8 AS clicks,
        SUM("cost_micros")::float8 AS cost_micros,
        SUM("conversions")::float8 AS conversions,
        SUM("conversion_value")::float8 AS conversion_value,
        SUM("impressions") FILTER (WHERE "date" BETWEEN ${last7Start}::date AND ${range.end}::date)::float8 AS impressions_7d,
        SUM("clicks") FILTER (WHERE "date" BETWEEN ${last7Start}::date AND ${range.end}::date)::float8 AS clicks_7d
      FROM "public"."ads_product_daily"
      WHERE "date" BETWEEN ${range.start}::date AND ${range.end}::date
      GROUP BY "merchant_id", "language_code", "feed_label", "offer_id"
    ),
    lifetime AS (
      SELECT
        "merchant_id"::text AS merchant_id,
        "language_code",
        "feed_label",
        "offer_id",
        COALESCE(SUM("conversions"), 0)::float8 AS conversions_lifetime
      FROM "public"."ads_product_daily"
      WHERE "date" <= ${range.end}::date
      GROUP BY "merchant_id", "language_code", "feed_label", "offer_id"
    )
    SELECT
      d.merchant_id,
      d.channel,
      d.language_code,
      d.feed_label,
      d.offer_id,
      d.impressions,
      d.clicks,
      d.cost_micros,
      d.conversions,
      d.conversion_value,
      d.impressions_7d,
      d.clicks_7d,
      COALESCE(l.conversions_lifetime, 0)::float8 AS conversions_lifetime
    FROM date_range d
    LEFT JOIN lifetime l
      ON l.merchant_id = d.merchant_id
      AND l.language_code = d.language_code
      AND l.feed_label = d.feed_label
      AND l.offer_id = d.offer_id
  `);
}

function buildEntities(
  inventory: InventoryOffer[],
  perfRows: OfferPerf[],
  granularity: FunnelGranularity
): EntityRow[] {
  const perfMap = new Map<string, OfferPerf>();
  for (const row of perfRows) {
    perfMap.set(offerKey(row), row);
  }

  const map = new Map<string, EntityRow>();
  for (const inv of inventory) {
    const perf = perfMap.get(offerKey(inv));
    const eKey = entityKey(granularity, inv);
    const existing = map.get(eKey.key);
    if (!existing) {
      map.set(eKey.key, {
        key: eKey.key,
        unmapped: eKey.unmapped,
        targeted: inv.targeted_campaign_ids.length > 0,
        impressions: perf?.impressions ?? 0,
        clicks: perf?.clicks ?? 0,
        costMicros: perf?.cost_micros ?? 0,
        conversions: perf?.conversions ?? 0,
        conversionValue: perf?.conversion_value ?? 0,
        impressions7d: perf?.impressions_7d ?? 0,
        clicks7d: perf?.clicks_7d ?? 0,
        conversionsLifetime: perf?.conversions_lifetime ?? 0,
        brand: inv.brand,
        customAttr0: inv.custom_attr0,
        customAttr1: inv.custom_attr1,
        productType: inv.product_type,
      });
      continue;
    }
    existing.targeted = existing.targeted || inv.targeted_campaign_ids.length > 0;
    existing.impressions += perf?.impressions ?? 0;
    existing.clicks += perf?.clicks ?? 0;
    existing.costMicros += perf?.cost_micros ?? 0;
    existing.conversions += perf?.conversions ?? 0;
    existing.conversionValue += perf?.conversion_value ?? 0;
    existing.impressions7d += perf?.impressions_7d ?? 0;
    existing.clicks7d += perf?.clicks_7d ?? 0;
    existing.conversionsLifetime += perf?.conversions_lifetime ?? 0;
  }
  return [...map.values()];
}

function shapeStep(step: string, rows: EntityRow[], previousCount: number, totalCount: number): StepShape {
  const impressions = rows.reduce((s, r) => s + r.impressions, 0);
  const clicks = rows.reduce((s, r) => s + r.clicks, 0);
  const cost = rows.reduce((s, r) => s + r.costMicros, 0);
  const conversions = rows.reduce((s, r) => s + r.conversions, 0);
  const value = rows.reduce((s, r) => s + r.conversionValue, 0);
  return {
    step,
    count: rows.length,
    pctOfPrevious:
      previousCount > 0 ? Number(((rows.length / previousCount) * 100).toFixed(2)) : null,
    pctOfTotal: totalCount > 0 ? Number(((rows.length / totalCount) * 100).toFixed(2)) : null,
    impressions,
    clicks,
    spendChf: toChf(cost),
    conversions: Number(conversions.toFixed(2)),
    valueChf: Number(value.toFixed(2)),
    roas: roas(value, cost),
  };
}

function concentration(values: EntityRow[], field: "impressions" | "clicks" | "costMicros" | "conversionValue") {
  const sorted = [...values].sort((a, b) => (b[field] as number) - (a[field] as number));
  const total = sorted.reduce((s, r) => s + (r[field] as number), 0);
  const take = (pct: number) => {
    if (sorted.length === 0 || total <= 0) return 0;
    const count = Math.max(1, Math.ceil(sorted.length * pct));
    const top = sorted.slice(0, count).reduce((s, r) => s + (r[field] as number), 0);
    return Number(((top / total) * 100).toFixed(2));
  };
  return { top1pct: take(0.01), top5pct: take(0.05), top10pct: take(0.1) };
}

function distribution(values: EntityRow[], field: "impressions" | "clicks" | "costMicros") {
  const n = (row: EntityRow) => (field === "costMicros" ? row.costMicros / 1e6 : row[field]);
  const buckets = {
    zero: 0,
    oneTo10: 0,
    elevenTo50: 0,
    fiftyOneTo100: 0,
    oneOhOneTo500: 0,
    over500: 0,
  };
  for (const row of values) {
    const value = n(row);
    if (value <= 0) buckets.zero += 1;
    else if (value <= 10) buckets.oneTo10 += 1;
    else if (value <= 50) buckets.elevenTo50 += 1;
    else if (value <= 100) buckets.fiftyOneTo100 += 1;
    else if (value <= 500) buckets.oneOhOneTo500 += 1;
    else buckets.over500 += 1;
  }
  return buckets;
}

function economicSegments(values: EntityRow[]) {
  const segmentRows = {
    noSpend: values.filter((r) => r.costMicros <= 0),
    spendZeroConv: values.filter((r) => r.costMicros > 0 && r.conversions <= 0),
    roasBelowBreakEven: values.filter((r) => r.costMicros > 0 && (r.conversionValue / (r.costMicros / 1e6)) < BREAK_EVEN_ROAS),
    roasBreakEvenToTarget: values.filter((r) => {
      if (r.costMicros <= 0) return false;
      const rRoas = r.conversionValue / (r.costMicros / 1e6);
      return rRoas >= BREAK_EVEN_ROAS && rRoas < TARGET_ROAS;
    }),
    roasTargetOrMore: values.filter((r) => r.costMicros > 0 && (r.conversionValue / (r.costMicros / 1e6)) >= TARGET_ROAS),
  };
  const totalSpend = values.reduce((s, r) => s + r.costMicros, 0);
  const totalValue = values.reduce((s, r) => s + r.conversionValue, 0);
  const shape = (rows: EntityRow[]) => {
    const spend = rows.reduce((s, r) => s + r.costMicros, 0);
    const value = rows.reduce((s, r) => s + r.conversionValue, 0);
    const conversions = rows.reduce((s, r) => s + r.conversions, 0);
    const contribution = value * DEFAULT_GROSS_MARGIN - spend / 1e6;
    return {
      models: rows.length,
      spendChf: toChf(spend),
      conversionValueChf: Number(value.toFixed(2)),
      conversions: Number(conversions.toFixed(2)),
      roas: roas(value, spend),
      grossAdContributionChf: Number(contribution.toFixed(2)),
      spendSharePct: totalSpend > 0 ? Number(((spend / totalSpend) * 100).toFixed(2)) : null,
      valueSharePct: totalValue > 0 ? Number(((value / totalValue) * 100).toFixed(2)) : null,
    };
  };
  return {
    noSpend: shape(segmentRows.noSpend),
    spendZeroConversion: shape(segmentRows.spendZeroConv),
    roasBelowBreakEven: shape(segmentRows.roasBelowBreakEven),
    roasBreakEvenToTarget: shape(segmentRows.roasBreakEvenToTarget),
    roasTargetOrMore: shape(segmentRows.roasTargetOrMore),
    note: "grossAdContribution = conversion_value × gross_margin − cost (before payment/shipping/returns/fixed costs)",
  };
}

function zombieReadiness(values: EntityRow[]) {
  const a = values.filter((r) => r.impressions <= 0);
  const b = values.filter((r) => r.impressions > 0 && r.clicks <= 0);
  const c = values.filter((r) => r.clicks > 0 && r.conversions <= 0);
  const d = values.filter((r) => r.conversionsLifetime > 0);
  const e = values.filter((r) => r.impressions <= 10 && r.clicks <= 1 && r.conversionsLifetime <= 0);
  const f = values.filter((r) => !r.targeted);
  const shape = (rows: EntityRow[]) => ({
    models: rows.length,
    impressions: rows.reduce((s, r) => s + r.impressions, 0),
    clicks: rows.reduce((s, r) => s + r.clicks, 0),
    spendChf: toChf(rows.reduce((s, r) => s + r.costMicros, 0)),
    conversions: Number(rows.reduce((s, r) => s + r.conversions, 0).toFixed(2)),
    valueChf: Number(rows.reduce((s, r) => s + r.conversionValue, 0).toFixed(2)),
    historicalConvertersIncluded: rows.filter((r) => r.conversionsLifetime > 0).length,
  });
  return {
    A_noImpression30d: shape(a),
    B_impressionNoClick: shape(b),
    C_clickNoConversion: shape(c),
    D_historicalConverters: shape(d),
    E_neverReallyTested: shape(e),
    F_nonTargetedNow: shape(f),
  };
}

function funnelForRows(values: EntityRow[]) {
  const total = values;
  const targeted = total.filter((r) => r.targeted);
  const withImpr = targeted.filter((r) => r.impressions > 0);
  const withClicks = withImpr.filter((r) => r.clicks > 0);
  const withSpend = withClicks.filter((r) => r.costMicros > 0);
  const withConv = withSpend.filter((r) => r.conversions > 0);
  const breakEven = withConv.filter((r) => (r.conversionValue / (r.costMicros / 1e6)) >= BREAK_EVEN_ROAS);
  const target = withConv.filter((r) => (r.conversionValue / (r.costMicros / 1e6)) >= TARGET_ROAS);
  return [
    shapeStep("inventory_current", total, total.length, total.length),
    shapeStep("included_in_active_campaign", targeted, total.length, total.length),
    shapeStep("with_impressions", withImpr, targeted.length, total.length),
    shapeStep("with_clicks", withClicks, withImpr.length, total.length),
    shapeStep("with_spend", withSpend, withClicks.length, total.length),
    shapeStep("with_conversions", withConv, withSpend.length, total.length),
    shapeStep("break_even_gross", breakEven, withConv.length, total.length),
    shapeStep("target_roas_5_plus", target, withConv.length, total.length),
  ];
}

async function computeWindow(
  range: DateRange,
  granularity: FunnelGranularity,
  inventory: InventoryOffer[]
) {
  const perf = await loadOfferPerf(range);
  const rows = buildEntities(inventory, perf, granularity);
  const steps = funnelForRows(rows);
  const currentStepCount = {
    withImpressions7d: rows.filter((r) => r.targeted && r.impressions7d > 0).length,
    withClicks7d: rows.filter((r) => r.targeted && r.clicks7d > 0).length,
  };
  const spend = rows.reduce((s, r) => s + r.costMicros, 0);
  const clicks = rows.reduce((s, r) => s + r.clicks, 0);
  const impressions = rows.reduce((s, r) => s + r.impressions, 0);
  const conversions = rows.reduce((s, r) => s + r.conversions, 0);
  const value = rows.reduce((s, r) => s + r.conversionValue, 0);
  return {
    range,
    granularity,
    totals: {
      entities: rows.length,
      targeted: rows.filter((r) => r.targeted).length,
      notTargeted: rows.filter((r) => !r.targeted).length,
      unmapped: rows.filter((r) => r.unmapped).length,
      impressions,
      clicks,
      spendChf: toChf(spend),
      conversions: Number(conversions.toFixed(2)),
      valueChf: Number(value.toFixed(2)),
      roas: roas(value, spend),
      ctr: ctr(clicks, impressions),
      cpc: cpc(spend, clicks),
      cvr: cvr(conversions, clicks),
      aov: aov(value, conversions),
      grossAdContributionChf: Number((value * DEFAULT_GROSS_MARGIN - spend / 1e6).toFixed(2)),
    },
    steps,
    economicSegments: economicSegments(rows),
    zombieReadiness: zombieReadiness(rows),
    currentStepCount,
    concentration: {
      impressions: concentration(rows, "impressions"),
      clicks: concentration(rows, "clicks"),
      spend: concentration(rows, "costMicros"),
      value: concentration(rows, "conversionValue"),
    },
    distributions: {
      impressions: distribution(rows, "impressions"),
      clicks: distribution(rows, "clicks"),
      spendChf: distribution(rows, "costMicros"),
    },
  };
}

export async function buildFunnelReport(options: FunnelCommandOptions = {}) {
  const days = Number.isFinite(options.days ?? 30) ? Math.max(7, Math.floor(options.days ?? 30)) : 30;
  const granularity = parseGranularity(options.granularity);
  const end = defaultEndDate();
  const current = toRange(days, end);
  const prior = { start: addDays(current.start, -days), end: addDays(current.start, -1) };
  const yoy = { start: addDays(current.start, -365), end: addDays(current.end, -365) };

  const inventory = await loadInventoryOffers();
  const [currentRes, priorRes, yoyRes] = await Promise.all([
    computeWindow(current, granularity, inventory),
    computeWindow(prior, granularity, inventory),
    computeWindow(yoy, granularity, inventory),
  ]);

  return {
    settings: {
      days,
      granularity,
      defaultGrossMargin: DEFAULT_GROSS_MARGIN,
      targetRoas: TARGET_ROAS,
      breakEvenRoas: BREAK_EVEN_ROAS,
    },
    periods: { current, prior, yoy },
    current: currentRes,
    prior: priorRes,
    yoy: yoyRes,
  };
}

export async function funnelCommand(options: FunnelCommandOptions = {}): Promise<number> {
  return withSyncRun("funnel", options, async () => {
    const report = await buildFunnelReport(options);
    log("funnel.summary", {
      days: report.settings.days,
      granularity: report.settings.granularity,
      currentTotals: report.current.totals,
      steps: report.current.steps,
    });
    return report;
  });
}
