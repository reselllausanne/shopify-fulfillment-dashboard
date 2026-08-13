import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { Prisma } from "@prisma/client";

import { prisma } from "@/app/lib/prisma";
import { periodSnapshot } from "@/adsanalytics/commands/analyzeModels";
import { resolveAdsConfig } from "@/adsanalytics/config";
import {
  addDays,
  decisionRange,
  lagRange,
  type DateRange,
} from "@/adsanalytics/dates";
import { searchAll, type GoogleAdsRow } from "@/adsanalytics/google/adsClient";
import {
  pmaxAssetGroupAssetQuery,
  pmaxAssetGroupListingGroupQuery,
  pmaxAssetGroupQuery,
  pmaxCampaignSettingsQuery,
  pmaxChannelPerformanceQuery,
} from "@/adsanalytics/google/queries";
import { stringifySafe } from "@/adsanalytics/json";
import { log, withSyncRun } from "@/adsanalytics/run";

const CURRENT: DateRange = { start: "2026-07-06", end: "2026-08-04" };
const PRIOR: DateRange = { start: "2026-06-06", end: "2026-07-05" };
const CONVERSION_LAG_DAYS = 7;
const COOLDOWN_MIN_SPEND_CHF = 20;
const TARGET_ROAS = 5;
const STOREFRONT_BASE = "https://resell.ch/products";
const FOCUS_CAMPAIGN_RE = /vetements|lego/i;

function toChf(micros: number): number {
  return Number((micros / 1e6).toFixed(2));
}

function roas(value: number, costMicros: number): number | null {
  if (costMicros <= 0) return null;
  return Number((value / (costMicros / 1e6)).toFixed(3));
}

function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v) || 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  return 0;
}

function str(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

function dig(row: GoogleAdsRow, pathParts: string[]): unknown {
  let cur: unknown = row;
  for (const p of pathParts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

type CohortMetrics = {
  modelCount: number;
  impressions: number;
  clicks: number;
  spendChf: number;
  conversions: number;
  valueChf: number;
  roas: number | null;
  avgSpendPerModelChf: number | null;
  zeroConversionSpendChf: number;
  zeroConversionModels: number;
};

function emptyCohort(): CohortMetrics {
  return {
    modelCount: 0,
    impressions: 0,
    clicks: 0,
    spendChf: 0,
    conversions: 0,
    valueChf: 0,
    roas: null,
    avgSpendPerModelChf: null,
    zeroConversionSpendChf: 0,
    zeroConversionModels: 0,
  };
}

function shapeCohort(
  rows: Array<{
    impressions: number;
    clicks: number;
    cost: number;
    conversions: number;
    value: number;
  }>
): CohortMetrics {
  if (rows.length === 0) return emptyCohort();
  const cost = rows.reduce((s, r) => s + r.cost, 0);
  const value = rows.reduce((s, r) => s + r.value, 0);
  const zero = rows.filter((r) => r.conversions === 0 && r.cost > 0);
  return {
    modelCount: rows.length,
    impressions: rows.reduce((s, r) => s + r.impressions, 0),
    clicks: rows.reduce((s, r) => s + r.clicks, 0),
    spendChf: toChf(cost),
    conversions: Number(rows.reduce((s, r) => s + r.conversions, 0).toFixed(2)),
    valueChf: Number(value.toFixed(2)),
    roas: roas(value, cost),
    avgSpendPerModelChf: Number((cost / 1e6 / rows.length).toFixed(2)),
    zeroConversionSpendChf: toChf(zero.reduce((s, r) => s + r.cost, 0)),
    zeroConversionModels: zero.length,
  };
}

type ModelAgg = {
  shopify_product_id: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  value: number;
};

async function loadModelAgg(range: DateRange): Promise<ModelAgg[]> {
  return prisma.$queryRaw<ModelAgg[]>(Prisma.sql`
    SELECT
      "shopify_product_id"::text AS shopify_product_id,
      SUM("impressions")::float8 AS impressions,
      SUM("clicks")::float8 AS clicks,
      SUM("cost_micros")::float8 AS cost,
      SUM("conversions")::float8 AS conversions,
      SUM("conversion_value")::float8 AS value
    FROM "public"."ads_product_daily"
    WHERE "date" BETWEEN ${range.start}::date AND ${range.end}::date
      AND "shopify_product_id" IS NOT NULL
      AND "offer_id" <> ''
    GROUP BY "shopify_product_id"
  `);
}

type DimRow = {
  dim: string;
  shopify_product_id: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  value: number;
};

async function loadDimAgg(range: DateRange, dimExpr: Prisma.Sql): Promise<DimRow[]> {
  return prisma.$queryRaw<DimRow[]>(Prisma.sql`
    SELECT
      ${dimExpr} AS dim,
      "shopify_product_id"::text AS shopify_product_id,
      SUM("impressions")::float8 AS impressions,
      SUM("clicks")::float8 AS clicks,
      SUM("cost_micros")::float8 AS cost,
      SUM("conversions")::float8 AS conversions,
      SUM("conversion_value")::float8 AS value
    FROM "public"."ads_product_daily"
    WHERE "date" BETWEEN ${range.start}::date AND ${range.end}::date
      AND "shopify_product_id" IS NOT NULL
      AND "offer_id" <> ''
    GROUP BY ${dimExpr}, "shopify_product_id"
  `);
}

async function catalogueExpansion() {
  const [currentModels, priorModels] = await Promise.all([
    loadModelAgg(CURRENT),
    loadModelAgg(PRIOR),
  ]);
  const currentMap = new Map(currentModels.map((m) => [m.shopify_product_id, m]));
  const priorMap = new Map(priorModels.map((m) => [m.shopify_product_id, m]));
  const currentIds = new Set(currentMap.keys());
  const priorIds = new Set(priorMap.keys());

  const continuingIds = [...currentIds].filter((id) => priorIds.has(id));
  const newIds = [...currentIds].filter((id) => !priorIds.has(id));
  const lostIds = [...priorIds].filter((id) => !currentIds.has(id));

  const pick = (ids: string[], map: Map<string, ModelAgg>) =>
    ids.map((id) => map.get(id)!).filter(Boolean);

  const overall = {
    continuing: shapeCohort(pick(continuingIds, currentMap)),
    newModels: shapeCohort(pick(newIds, currentMap)),
    lostModels: shapeCohort(pick(lostIds, priorMap)),
    note:
      "continuing/new metrics = current-period performance. lost metrics = prior-period performance (absent in current).",
  };

  const [byCampaignRows, byAttr0, byAttr1, byLang, priorByCampaign, priorByAttr0, priorByAttr1, priorByLang] =
    await Promise.all([
      loadDimAgg(CURRENT, Prisma.sql`COALESCE(NULLIF("campaign_name", ''), '(empty)')`),
      loadDimAgg(CURRENT, Prisma.sql`COALESCE(NULLIF("custom_attr0", ''), '(empty)')`),
      loadDimAgg(CURRENT, Prisma.sql`COALESCE(NULLIF("custom_attr1", ''), '(empty)')`),
      loadDimAgg(CURRENT, Prisma.sql`COALESCE(NULLIF("language_code", ''), '(empty)')`),
      loadDimAgg(PRIOR, Prisma.sql`COALESCE(NULLIF("campaign_name", ''), '(empty)')`),
      loadDimAgg(PRIOR, Prisma.sql`COALESCE(NULLIF("custom_attr0", ''), '(empty)')`),
      loadDimAgg(PRIOR, Prisma.sql`COALESCE(NULLIF("custom_attr1", ''), '(empty)')`),
      loadDimAgg(PRIOR, Prisma.sql`COALESCE(NULLIF("language_code", ''), '(empty)')`),
    ]);

  function withLost(
    currentRows: DimRow[],
    priorRows: DimRow[]
  ): Array<{
    dim: string;
    continuing: CohortMetrics;
    newModels: CohortMetrics;
    lostModels: CohortMetrics;
  }> {
    const dims = new Set<string>();
    for (const r of currentRows) dims.add(r.dim || "(empty)");
    for (const r of priorRows) dims.add(r.dim || "(empty)");

    const curByDim = new Map<string, DimRow[]>();
    for (const r of currentRows) {
      const k = r.dim || "(empty)";
      const list = curByDim.get(k) ?? [];
      list.push(r);
      curByDim.set(k, list);
    }
    const priorByDim = new Map<string, DimRow[]>();
    for (const r of priorRows) {
      const k = r.dim || "(empty)";
      const list = priorByDim.get(k) ?? [];
      list.push(r);
      priorByDim.set(k, list);
    }

    return [...dims]
      .sort()
      .map((dim) => {
        const cur = curByDim.get(dim) ?? [];
        const pri = priorByDim.get(dim) ?? [];
        const priIds = new Set(pri.map((r) => r.shopify_product_id));
        const curIds = new Set(cur.map((r) => r.shopify_product_id));
        return {
          dim,
          continuing: shapeCohort(cur.filter((r) => priIds.has(r.shopify_product_id))),
          newModels: shapeCohort(cur.filter((r) => !priIds.has(r.shopify_product_id))),
          lostModels: shapeCohort(pri.filter((r) => !curIds.has(r.shopify_product_id))),
        };
      })
      .sort((a, b) => b.continuing.spendChf + b.newModels.spendChf - (a.continuing.spendChf + a.newModels.spendChf));
  }

  return {
    periods: { current: CURRENT, prior: PRIOR },
    overall,
    byCampaign: withLost(byCampaignRows, priorByCampaign),
    byCustomAttr0: withLost(byAttr0, priorByAttr0),
    byCustomAttr1: withLost(byAttr1, priorByAttr1),
    byLanguage: withLost(byLang, priorByLang),
  };
}

async function dailyChangePoint() {
  type DayRow = {
    day: string;
    shopify_product_id: string;
    impressions: number;
    clicks: number;
    cost: number;
    conversions: number;
    value: number;
  };

  const window: DateRange = { start: PRIOR.start, end: CURRENT.end };
  const rows = await prisma.$queryRaw<DayRow[]>(Prisma.sql`
    SELECT
      "date"::text AS day,
      "shopify_product_id"::text AS shopify_product_id,
      SUM("impressions")::float8 AS impressions,
      SUM("clicks")::float8 AS clicks,
      SUM("cost_micros")::float8 AS cost,
      SUM("conversions")::float8 AS conversions,
      SUM("conversion_value")::float8 AS value
    FROM "public"."ads_product_daily"
    WHERE "date" BETWEEN ${window.start}::date AND ${window.end}::date
      AND "shopify_product_id" IS NOT NULL
      AND "offer_id" <> ''
    GROUP BY "date", "shopify_product_id"
  `);

  // First impression day across imported window (prior+current).
  const firstSeen = new Map<string, string>();
  for (const r of rows) {
    if (r.impressions <= 0 && r.cost <= 0 && r.clicks <= 0) continue;
    const prev = firstSeen.get(r.shopify_product_id);
    if (!prev || r.day < prev) firstSeen.set(r.shopify_product_id, r.day);
  }

  const byDay = new Map<string, DayRow[]>();
  for (const r of rows) {
    const list = byDay.get(r.day) ?? [];
    list.push(r);
    byDay.set(r.day, list);
  }

  const days = [...byDay.keys()].sort();
  const cumulative = new Set<string>();
  let prevCum = 0;

  const daily = days.map((day) => {
    const dayRows = byDay.get(day) ?? [];
    const exposed = dayRows.filter((r) => r.impressions > 0 || r.clicks > 0 || r.cost > 0);
    const exposedIds = new Set(exposed.map((r) => r.shopify_product_id));
    const newly = exposed.filter((r) => firstSeen.get(r.shopify_product_id) === day);
    const newlyIds = new Set(newly.map((r) => r.shopify_product_id));
    const withSpend = exposed.filter((r) => r.cost > 0);

    const newTraffic = exposed.filter((r) => newlyIds.has(r.shopify_product_id));
    const prevTraffic = exposed.filter((r) => !newlyIds.has(r.shopify_product_id));

    for (const id of exposedIds) cumulative.add(id);
    const cum = cumulative.size;
    const cumDelta = cum - prevCum;
    prevCum = cum;

    const newCost = newTraffic.reduce((s, r) => s + r.cost, 0);
    const newValue = newTraffic.reduce((s, r) => s + r.value, 0);
    const prevCost = prevTraffic.reduce((s, r) => s + r.cost, 0);
    const prevValue = prevTraffic.reduce((s, r) => s + r.value, 0);
    const allCost = exposed.reduce((s, r) => s + r.cost, 0);
    const allValue = exposed.reduce((s, r) => s + r.value, 0);

    return {
      date: day,
      distinctExposedModels: exposedIds.size,
      newlyExposedModels: newlyIds.size,
      modelsWithSpend: withSpend.length,
      spendOnNewlyExposedChf: toChf(newCost),
      newlyExposed: {
        spendChf: toChf(newCost),
        valueChf: Number(newValue.toFixed(2)),
        roas: roas(newValue, newCost),
        models: newlyIds.size,
      },
      previouslyExposed: {
        spendChf: toChf(prevCost),
        valueChf: Number(prevValue.toFixed(2)),
        roas: roas(prevValue, prevCost),
        models: prevTraffic.length,
      },
      dayTotal: {
        spendChf: toChf(allCost),
        valueChf: Number(allValue.toFixed(2)),
        roas: roas(allValue, allCost),
      },
      cumulativeDistinctModels: cum,
      cumulativeModelDelta: cumDelta,
    };
  });

  // Material catalogue expansion: largest cumulative jump in current period.
  const currentDaily = daily.filter((d) => d.date >= CURRENT.start && d.date <= CURRENT.end);
  const maxJump = [...currentDaily].sort(
    (a, b) => b.cumulativeModelDelta - a.cumulativeModelDelta || b.newlyExposedModels - a.newlyExposedModels
  )[0];

  // Also flag largest newlyExposedModels day
  const maxNew = [...currentDaily].sort((a, b) => b.newlyExposedModels - a.newlyExposedModels)[0];

  // ROAS path in current period (7d rolling for readability)
  const rolling: Array<{ date: string; roas7d: number | null; spend7d: number; value7d: number }> = [];
  for (let i = 0; i < currentDaily.length; i += 1) {
    const slice = currentDaily.slice(Math.max(0, i - 6), i + 1);
    const spend = slice.reduce((s, d) => s + d.dayTotal.spendChf, 0);
    const value = slice.reduce((s, d) => s + d.dayTotal.valueChf, 0);
    rolling.push({
      date: currentDaily[i]!.date,
      spend7d: Number(spend.toFixed(2)),
      value7d: Number(value.toFixed(2)),
      roas7d: spend > 0 ? Number((value / spend).toFixed(3)) : null,
    });
  }

  const early = currentDaily.slice(0, 7);
  const late = currentDaily.slice(-7);
  const earlyRoas =
    early.reduce((s, d) => s + d.dayTotal.spendChf, 0) > 0
      ? Number(
          (
            early.reduce((s, d) => s + d.dayTotal.valueChf, 0) /
            early.reduce((s, d) => s + d.dayTotal.spendChf, 0)
          ).toFixed(3)
        )
      : null;
  const lateRoas =
    late.reduce((s, d) => s + d.dayTotal.spendChf, 0) > 0
      ? Number(
          (
            late.reduce((s, d) => s + d.dayTotal.valueChf, 0) /
            late.reduce((s, d) => s + d.dayTotal.spendChf, 0)
          ).toFixed(3)
        )
      : null;

  return {
    window,
    firstSeenDefinition:
      "newlyExposed = first day with impressions/clicks/spend for that shopify_product_id inside prior+current imported window",
    daily,
    rolling7dRoasCurrentPeriod: rolling,
    materialExposureIncrease: {
      byCumulativeJump: maxJump
        ? {
            date: maxJump.date,
            cumulativeModelDelta: maxJump.cumulativeModelDelta,
            newlyExposedModels: maxJump.newlyExposedModels,
            cumulativeDistinctModels: maxJump.cumulativeDistinctModels,
            dayRoas: maxJump.dayTotal.roas,
          }
        : null,
      byNewlyExposedCount: maxNew
        ? {
            date: maxNew.date,
            newlyExposedModels: maxNew.newlyExposedModels,
            cumulativeModelDelta: maxNew.cumulativeModelDelta,
            dayRoas: maxNew.dayTotal.roas,
          }
        : null,
    },
    correspondenceWithRoasDecline: {
      note: "No causation claimed. Shows temporal alignment only.",
      early7dRoas: earlyRoas,
      late7dRoas: lateRoas,
      early7dSpendChf: Number(early.reduce((s, d) => s + d.dayTotal.spendChf, 0).toFixed(2)),
      late7dSpendChf: Number(late.reduce((s, d) => s + d.dayTotal.spendChf, 0).toFixed(2)),
      exposureJumpDate: maxJump?.date ?? null,
      roasDeclinedAfterJump:
        earlyRoas != null && lateRoas != null ? lateRoas < earlyRoas : null,
    },
  };
}

async function cooldownCandidates() {
  const decision = decisionRange(CURRENT, CONVERSION_LAG_DAYS);
  const lag = lagRange(CURRENT, CONVERSION_LAG_DAYS);
  const latest7: DateRange = lag ?? {
    start: addDays(CURRENT.end, -6),
    end: CURRENT.end,
  };
  const days60: DateRange = { start: PRIOR.start, end: CURRENT.end };

  type Cand = {
    shopify_product_id: string;
    title: string | null;
    brand: string | null;
    clicks_decision: number;
    cost_decision: number;
    conv_decision: number;
    conv_latest7: number;
    cost_30: number;
    value_30: number;
    clicks_30: number;
    cost_60: number;
    value_60: number;
    handle: string | null;
    retail_price: number | null;
    listing_price: number | null;
  };

  const rows = await prisma.$queryRaw<Cand[]>(Prisma.sql`
    WITH decision AS (
      SELECT
        "shopify_product_id"::text AS pid,
        SUM("clicks")::float8 AS clicks,
        SUM("cost_micros")::float8 AS cost,
        SUM("conversions")::float8 AS conv,
        (ARRAY_AGG("title" ORDER BY "date" DESC) FILTER (WHERE "title" <> ''))[1] AS title,
        (ARRAY_AGG("brand" ORDER BY "date" DESC) FILTER (WHERE "brand" <> ''))[1] AS brand
      FROM "public"."ads_product_daily"
      WHERE "date" BETWEEN ${decision.start}::date AND ${decision.end}::date
        AND "shopify_product_id" IS NOT NULL
        AND "offer_id" <> ''
      GROUP BY "shopify_product_id"
      HAVING SUM("conversions") = 0
         AND SUM("cost_micros") >= ${COOLDOWN_MIN_SPEND_CHF * 1e6}
    ),
    latest7 AS (
      SELECT
        "shopify_product_id"::text AS pid,
        SUM("conversions")::float8 AS conv
      FROM "public"."ads_product_daily"
      WHERE "date" BETWEEN ${latest7.start}::date AND ${latest7.end}::date
        AND "shopify_product_id" IS NOT NULL
        AND "offer_id" <> ''
      GROUP BY "shopify_product_id"
    ),
    m30 AS (
      SELECT
        "shopify_product_id"::text AS pid,
        SUM("cost_micros")::float8 AS cost,
        SUM("conversion_value")::float8 AS value,
        SUM("clicks")::float8 AS clicks
      FROM "public"."ads_product_daily"
      WHERE "date" BETWEEN ${CURRENT.start}::date AND ${CURRENT.end}::date
        AND "shopify_product_id" IS NOT NULL
        AND "offer_id" <> ''
      GROUP BY "shopify_product_id"
    ),
    m60 AS (
      SELECT
        "shopify_product_id"::text AS pid,
        SUM("cost_micros")::float8 AS cost,
        SUM("conversion_value")::float8 AS value
      FROM "public"."ads_product_daily"
      WHERE "date" BETWEEN ${days60.start}::date AND ${days60.end}::date
        AND "shopify_product_id" IS NOT NULL
        AND "offer_id" <> ''
      GROUP BY "shopify_product_id"
    )
    SELECT
      d.pid AS shopify_product_id,
      d.title,
      d.brand,
      d.clicks AS clicks_decision,
      d.cost AS cost_decision,
      d.conv AS conv_decision,
      COALESCE(l.conv, 0)::float8 AS conv_latest7,
      COALESCE(m.cost, 0)::float8 AS cost_30,
      COALESCE(m.value, 0)::float8 AS value_30,
      COALESCE(m.clicks, 0)::float8 AS clicks_30,
      COALESCE(s.cost, 0)::float8 AS cost_60,
      COALESCE(s.value, 0)::float8 AS value_60,
      (
        SELECT ss."shopifyHandle"
        FROM "ShopifySyncState" ss
        WHERE ss."shopifyProductId" = 'gid://shopify/Product/' || d.pid
          AND ss."shopifyHandle" IS NOT NULL
        ORDER BY ss."shopifySyncedAt" DESC NULLS LAST
        LIMIT 1
      ) AS handle,
      (
        SELECT k."retailPrice"::float8
        FROM "ShopifySyncState" ss
        JOIN "KickDBProduct" k ON k."kickdbProductId" = ss."kickdbProductId"
        WHERE ss."shopifyProductId" = 'gid://shopify/Product/' || d.pid
          AND k."retailPrice" IS NOT NULL
        ORDER BY ss."shopifySyncedAt" DESC NULLS LAST
        LIMIT 1
      ) AS retail_price,
      (
        SELECT MAX(cls."lastPushedPrice")::float8
        FROM "ChannelListingState" cls
        WHERE cls.channel = 'SHOPIFY'
          AND cls."externalProductId" = 'gid://shopify/Product/' || d.pid
      ) AS listing_price
    FROM decision d
    LEFT JOIN latest7 l ON l.pid = d.pid
    LEFT JOIN m30 m ON m.pid = d.pid
    LEFT JOIN m60 s ON s.pid = d.pid
    WHERE COALESCE(l.conv, 0) = 0
    ORDER BY d.cost DESC
  `);

  const candidates = rows.map((r) => {
    const sellingPrice = r.listing_price ?? r.retail_price;
    const targetCac = sellingPrice != null ? Number((sellingPrice / TARGET_ROAS).toFixed(2)) : null;
    const spend30 = toChf(r.cost_30);
    const spendDecision = toChf(r.cost_decision);
    const ratio =
      targetCac != null && targetCac > 0
        ? Number((spendDecision / targetCac).toFixed(3))
        : null;
    return {
      shopifyProductId: r.shopify_product_id,
      title: r.title,
      brand: r.brand,
      shopifyUrl: r.handle ? `${STOREFRONT_BASE}/${r.handle}` : null,
      shopifyHandle: r.handle,
      currentSellingPriceChf: sellingPrice,
      priceSource:
        r.listing_price != null
          ? "ChannelListingState.lastPushedPrice"
          : r.retail_price != null
            ? "KickDBProduct.retailPrice"
            : null,
      clicks: r.clicks_30,
      clicksDecisionWindow: r.clicks_decision,
      spendDecisionWindowChf: spendDecision,
      spend30dChf: spend30,
      value30dChf: Number(r.value_30.toFixed(2)),
      spend60dChf: toChf(r.cost_60),
      value60dChf: Number(r.value_60.toFixed(2)),
      targetCacAtRoas5Chf: targetCac,
      spendOverTargetCacRatio: ratio,
      note: "Report only. Do not auto-exclude.",
    };
  });

  return {
    criteria: {
      zeroConversionsExcludingLag: decision,
      noConversionsLatest7Days: latest7,
      minSpendChfDecisionWindow: COOLDOWN_MIN_SPEND_CHF,
      targetRoas: TARGET_ROAS,
      autoExclude: false,
    },
    candidateCount: candidates.length,
    candidates,
  };
}

function shapeChannelRows(rows: GoogleAdsRow[]) {
  const shaped = rows.map((row) => {
    const cost = num(dig(row, ["metrics", "costMicros"]) ?? dig(row, ["metrics", "cost_micros"]));
    const conv = num(dig(row, ["metrics", "conversions"]));
    const value = num(
      dig(row, ["metrics", "conversionsValue"]) ?? dig(row, ["metrics", "conversions_value"])
    );
    return {
      campaignId: str(dig(row, ["campaign", "id"])),
      campaignName: str(dig(row, ["campaign", "name"])),
      adUsingProductData: dig(row, ["segments", "adUsingProductData"]) ?? dig(row, ["segments", "ad_using_product_data"]),
      adNetworkType: str(dig(row, ["segments", "adNetworkType"]) ?? dig(row, ["segments", "ad_network_type"])),
      adUsingVideo: dig(row, ["segments", "adUsingVideo"]) ?? dig(row, ["segments", "ad_using_video"]),
      spendChf: toChf(cost),
      conversions: Number(conv.toFixed(2)),
      valueChf: Number(value.toFixed(2)),
      roas: roas(value, cost),
    };
  });

  const focus = shaped.filter((r) => FOCUS_CAMPAIGN_RE.test(r.campaignName));
  const byCampaign = new Map<string, typeof shaped>();
  for (const r of shaped) {
    const list = byCampaign.get(r.campaignName) ?? [];
    list.push(r);
    byCampaign.set(r.campaignName, list);
  }

  const totalsByFlag = (list: typeof shaped) => {
    const withProduct = list.filter((r) => r.adUsingProductData === true || r.adUsingProductData === "true");
    const withoutProduct = list.filter((r) => r.adUsingProductData === false || r.adUsingProductData === "false");
    const sum = (xs: typeof shaped) => {
      const cost = xs.reduce((s, x) => s + x.spendChf, 0);
      const value = xs.reduce((s, x) => s + x.valueChf, 0);
      return {
        spendChf: Number(cost.toFixed(2)),
        valueChf: Number(value.toFixed(2)),
        conversions: Number(xs.reduce((s, x) => s + x.conversions, 0).toFixed(2)),
        roas: cost > 0 ? Number((value / cost).toFixed(3)) : null,
        rows: xs.length,
      };
    };
    return {
      usingProductData: sum(withProduct),
      notUsingProductData: sum(withoutProduct),
      all: sum(list),
    };
  };

  return {
    rowCount: shaped.length,
    focusCampaigns: [...new Set(focus.map((r) => r.campaignName))],
    focusRows: focus.sort((a, b) => b.spendChf - a.spendChf),
    focusTotals: totalsByFlag(focus),
    allTotals: totalsByFlag(shaped),
    byCampaign: [...byCampaign.entries()]
      .map(([name, list]) => ({
        campaignName: name,
        ...totalsByFlag(list),
        rows: list.sort((a, b) => b.spendChf - a.spendChf),
      }))
      .sort((a, b) => b.all.spendChf - a.all.spendChf),
  };
}

async function queryPmaxChannels() {
  const config = resolveAdsConfig();
  const [current, prior] = await Promise.all([
    searchAll(config, pmaxChannelPerformanceQuery(CURRENT.start, CURRENT.end)),
    searchAll(config, pmaxChannelPerformanceQuery(PRIOR.start, PRIOR.end)),
  ]);
  return {
    note: "Live GAQL from campaign resource with segments.ad_using_product_data / ad_network_type / ad_using_video. Read-only.",
    current: { period: CURRENT, stats: current.stats, ...shapeChannelRows(current.rows) },
    prior: { period: PRIOR, stats: prior.stats, ...shapeChannelRows(prior.rows) },
  };
}

async function queryPmaxSettings() {
  const config = resolveAdsConfig();

  async function safe(label: string, query: string) {
    try {
      const res = await searchAll(config, query);
      return { ok: true as const, label, stats: res.stats, rows: res.rows };
    } catch (err) {
      return {
        ok: false as const,
        label,
        error: err instanceof Error ? err.message : String(err),
        rows: [] as GoogleAdsRow[],
      };
    }
  }

  const [settings, groups, assets, listing] = await Promise.all([
    safe("campaign_settings", pmaxCampaignSettingsQuery()),
    safe("asset_groups", pmaxAssetGroupQuery()),
    safe("asset_group_assets", pmaxAssetGroupAssetQuery()),
    safe("listing_group_filters", pmaxAssetGroupListingGroupQuery()),
  ]);

  const campaigns = (settings.ok ? settings.rows : []).map((row) => {
    const id = str(dig(row, ["campaign", "id"]));
    const name = str(dig(row, ["campaign", "name"]));
    const automation = dig(row, ["campaign", "assetAutomationSettings"]) ??
      dig(row, ["campaign", "asset_automation_settings"]);
    const targetRoas =
      dig(row, ["campaign", "maximizeConversionValue", "targetRoas"]) ??
      dig(row, ["campaign", "maximize_conversion_value", "target_roas"]);
    const budgetMicros = num(
      dig(row, ["campaignBudget", "amountMicros"]) ?? dig(row, ["campaign_budget", "amount_micros"])
    );
    const merchantId =
      dig(row, ["campaign", "shoppingSetting", "merchantId"]) ??
      dig(row, ["campaign", "shopping_setting", "merchant_id"]);
    const feedLabel =
      dig(row, ["campaign", "shoppingSetting", "feedLabel"]) ??
      dig(row, ["campaign", "shopping_setting", "feed_label"]);
    const disableProductFeed =
      dig(row, ["campaign", "shoppingSetting", "disableProductFeed"]) ??
      dig(row, ["campaign", "shopping_setting", "disable_product_feed"]);

    const campaignGroups = (groups.ok ? groups.rows : []).filter(
      (g) => str(dig(g, ["campaign", "id"])) === id
    );
    const campaignAssets = (assets.ok ? assets.rows : []).filter(
      (a) => str(dig(a, ["campaign", "id"])) === id
    );
    const campaignListing = (listing.ok ? listing.rows : []).filter(
      (l) => str(dig(l, ["campaign", "id"])) === id
    );

    // Final URL Expansion + Text Asset Automation from asset_automation_settings (v25).
    let finalUrlExpansion: unknown = null;
    let textAssetAutomation: unknown = null;
    const autoList = Array.isArray(automation) ? automation : [];
    const automationRaw = autoList.map((item) => {
      if (!item || typeof item !== "object") return item;
      const t = str(
        (item as Record<string, unknown>).assetAutomationType ??
          (item as Record<string, unknown>).asset_automation_type
      );
      const st =
        (item as Record<string, unknown>).assetAutomationStatus ??
        (item as Record<string, unknown>).asset_automation_status;
      if (/FINAL_URL_EXPANSION/i.test(t)) finalUrlExpansion = st;
      if (/TEXT_ASSET_AUTOMATION/i.test(t)) textAssetAutomation = st;
      return { type: t, status: st };
    });

    const listingSources = [
      ...new Set(
        campaignListing.map((l) =>
          str(
            dig(l, ["assetGroupListingGroupFilter", "listingSource"]) ??
              dig(l, ["asset_group_listing_group_filter", "listing_source"])
          )
        )
      ),
    ].filter(Boolean);

    return {
      campaignId: id,
      campaignName: name,
      status: dig(row, ["campaign", "status"]),
      focus: FOCUS_CAMPAIGN_RE.test(name),
      finalUrlExpansion: {
        assetAutomationStatus: finalUrlExpansion,
        interpretation:
          finalUrlExpansion != null
            ? String(finalUrlExpansion)
            : "not returned (v25 default for PMax is typically OPTED_IN when absent)",
      },
      textAssetAutomation: {
        assetAutomationStatus: textAssetAutomation,
        interpretation: textAssetAutomation != null ? String(textAssetAutomation) : "not returned",
      },
      assetAutomationSettings: automationRaw,
      targetRoas: targetRoas ?? null,
      biddingStrategyType: dig(row, ["campaign", "biddingStrategyType"]) ?? dig(row, ["campaign", "bidding_strategy_type"]),
      budget: {
        amountMicros: budgetMicros,
        amountChf: toChf(budgetMicros),
        deliveryMethod: dig(row, ["campaignBudget", "deliveryMethod"]) ?? dig(row, ["campaign_budget", "delivery_method"]),
        period: dig(row, ["campaignBudget", "period"]) ?? dig(row, ["campaign_budget", "period"]),
      },
      feedTypes: {
        shoppingSettingMerchantId: merchantId ?? null,
        shoppingSettingFeedLabel: feedLabel ?? null,
        disableProductFeed: disableProductFeed ?? null,
        listingSources,
        listingGroupFilterCount: campaignListing.length,
        listingGroupFilterTypes: [
          ...new Set(
            campaignListing.map((l) =>
              str(
                dig(l, ["assetGroupListingGroupFilter", "type"]) ??
                  dig(l, ["asset_group_listing_group_filter", "type"])
              )
            )
          ),
        ].filter(Boolean),
      },
      assetGroups: campaignGroups.map((g) => ({
        assetGroupId: str(dig(g, ["assetGroup", "id"]) ?? dig(g, ["asset_group", "id"])),
        name: str(dig(g, ["assetGroup", "name"]) ?? dig(g, ["asset_group", "name"])),
        status: dig(g, ["assetGroup", "status"]) ?? dig(g, ["asset_group", "status"]),
        finalUrls: dig(g, ["assetGroup", "finalUrls"]) ?? dig(g, ["asset_group", "final_urls"]),
      })),
      assets: campaignAssets.map((a) => ({
        assetGroupId: str(dig(a, ["assetGroup", "id"]) ?? dig(a, ["asset_group", "id"])),
        assetGroupName: str(dig(a, ["assetGroup", "name"]) ?? dig(a, ["asset_group", "name"])),
        fieldType: dig(a, ["assetGroupAsset", "fieldType"]) ?? dig(a, ["asset_group_asset", "field_type"]),
        status: dig(a, ["assetGroupAsset", "status"]) ?? dig(a, ["asset_group_asset", "status"]),
        assetId: str(dig(a, ["asset", "id"])),
        assetType: dig(a, ["asset", "type"]),
        assetName: dig(a, ["asset", "name"]),
        text: dig(a, ["asset", "textAsset", "text"]) ?? dig(a, ["asset", "text_asset", "text"]),
        imageUrl:
          dig(a, ["asset", "imageAsset", "fullSize", "url"]) ??
          dig(a, ["asset", "image_asset", "full_size", "url"]),
        youtubeVideoId:
          dig(a, ["asset", "youtubeVideoAsset", "youtubeVideoId"]) ??
          dig(a, ["asset", "youtube_video_asset", "youtube_video_id"]),
      })),
      assetGroupCount: campaignGroups.length,
      assetLinkCount: campaignAssets.length,
    };
  });

  return {
    note: "Read-only campaign/asset queries. No mutate. Queries that fail are reported with error, not retried as writes.",
    queryStatus: {
      settings: settings.ok ? { ok: true, rows: settings.rows.length } : { ok: false, error: settings.error },
      assetGroups: groups.ok ? { ok: true, rows: groups.rows.length } : { ok: false, error: groups.error },
      assets: assets.ok ? { ok: true, rows: assets.rows.length } : { ok: false, error: assets.error },
      listingGroups: listing.ok ? { ok: true, rows: listing.rows.length } : { ok: false, error: listing.error },
    },
    campaigns: campaigns.sort((a, b) => a.campaignName.localeCompare(b.campaignName)),
    focusCampaigns: campaigns.filter((c) => c.focus),
  };
}

export async function deepDiveCommand(options: { outDir?: string; skipLive?: boolean } = {}) {
  return withSyncRun(
    "deep-dive",
    { current: CURRENT, prior: PRIOR, skipLive: options.skipLive ?? false },
    async () => {
      log("deep_dive.start", { current: CURRENT, prior: PRIOR });

      const [currentSnap, priorSnap, catalogue, changepoint, cooldown] = await Promise.all([
        periodSnapshot(CURRENT),
        periodSnapshot(PRIOR),
        catalogueExpansion(),
        dailyChangePoint(),
        cooldownCandidates(),
      ]);

      let pmaxChannels: unknown = { skipped: true };
      let pmaxSettings: unknown = { skipped: true };
      if (!options.skipLive) {
        pmaxChannels = await queryPmaxChannels();
        log("deep_dive.pmax_channels_done", {});
        pmaxSettings = await queryPmaxSettings();
        log("deep_dive.pmax_settings_done", {});
      }

      const terminology = {
        note:
          "Product-attributed ≠ overall. Always show three layers per period.",
        current: {
          totalCampaign: currentSnap.totalCampaign,
          productAttributed: {
            spendChf: currentSnap.productAttributed.spendChf,
            valueChf: currentSnap.productAttributed.valueChf,
            roas: currentSnap.productAttributed.roas,
            conversions: currentSnap.productAttributed.conversions,
            distinctShopifyModels: currentSnap.productAttributed.distinctShopifyModels,
          },
          uncovered: currentSnap.uncovered,
        },
        prior: {
          totalCampaign: priorSnap.totalCampaign,
          productAttributed: {
            spendChf: priorSnap.productAttributed.spendChf,
            valueChf: priorSnap.productAttributed.valueChf,
            roas: priorSnap.productAttributed.roas,
            conversions: priorSnap.productAttributed.conversions,
            distinctShopifyModels: priorSnap.productAttributed.distinctShopifyModels,
          },
          uncovered: priorSnap.uncovered,
        },
      };

      const report = {
        generatedAt: new Date().toISOString(),
        note: "Uses already-imported ads_* data. Live Google Ads queries are read-only. No backfill. No exclusions applied.",
        periods: { current: CURRENT, prior: PRIOR },
        terminologyFix: terminology,
        catalogueExpansion: catalogue,
        dailyChangePoint: changepoint,
        pmaxChannelPerformance: pmaxChannels,
        pmaxCampaignSettings: pmaxSettings,
        cooldownCandidates: cooldown,
      };

      const outDir = options.outDir ?? path.join(process.cwd(), "tmp");
      await mkdir(outDir, { recursive: true });
      const outFile = path.join(outDir, `ads-deep-dive-${CURRENT.start}_${CURRENT.end}.json`);
      await writeFile(outFile, stringifySafe(report, 2), "utf8");

      // Slim summary for logs / human scan
      const summaryFile = path.join(outDir, `ads-deep-dive-summary-${CURRENT.start}_${CURRENT.end}.json`);
      const summary = {
        terminologyFix: terminology,
        catalogueOverall: catalogue.overall,
        materialExposureIncrease: changepoint.materialExposureIncrease,
        correspondenceWithRoasDecline: changepoint.correspondenceWithRoasDecline,
        cooldownCandidateCount: cooldown.candidateCount,
        cooldownTop: cooldown.candidates.slice(0, 25),
        pmaxChannelFocus:
          pmaxChannels && typeof pmaxChannels === "object" && "current" in (pmaxChannels as object)
            ? {
                current: (pmaxChannels as { current: { focusTotals: unknown; focusCampaigns: unknown } }).current
                  .focusTotals,
                prior: (pmaxChannels as { prior: { focusTotals: unknown } }).prior.focusTotals,
                campaigns: (pmaxChannels as { current: { focusCampaigns: unknown } }).current.focusCampaigns,
              }
            : pmaxChannels,
        pmaxSettingsFocus:
          pmaxSettings && typeof pmaxSettings === "object" && "focusCampaigns" in (pmaxSettings as object)
            ? (pmaxSettings as { focusCampaigns: unknown; queryStatus: unknown }).focusCampaigns
            : pmaxSettings,
        files: { full: outFile, summary: summaryFile },
      };
      await writeFile(summaryFile, stringifySafe(summary, 2), "utf8");

      log("deep_dive.terminology", terminology);
      log("deep_dive.catalogue", catalogue.overall);
      log("deep_dive.changepoint", changepoint.materialExposureIncrease);
      log("deep_dive.roas_alignment", changepoint.correspondenceWithRoasDecline);
      log("deep_dive.cooldown", {
        count: cooldown.candidateCount,
        topSpend: cooldown.candidates.slice(0, 10).map((c) => ({
          id: c.shopifyProductId,
          title: c.title,
          spend: c.spendDecisionWindowChf,
          price: c.currentSellingPriceChf,
          ratio: c.spendOverTargetCacRatio,
        })),
      });
      log("deep_dive.report_written", { full: outFile, summary: summaryFile });

      return {
        reportFile: outFile,
        summaryFile,
        cooldownCandidates: cooldown.candidateCount,
      };
    }
  );
}
