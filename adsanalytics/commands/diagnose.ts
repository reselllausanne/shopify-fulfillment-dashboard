import { Prisma } from "@prisma/client";

import { prisma } from "@/app/lib/prisma";
import { addDays, defaultEndDate } from "@/adsanalytics/dates";
import { log, withSyncRun } from "@/adsanalytics/run";

const DEFAULT_GROSS_MARGIN = 0.3035;

type DiagnoseOptions = { days?: number };

type TotalsRow = {
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  value: number;
};

type ModelPerfRow = {
  shopify_product_id: string;
  cost: number;
  conversions: number;
  value: number;
};

function toRange(days: number, end: string) {
  return { start: addDays(end, -(days - 1)), end };
}

function roas(value: number, costMicros: number): number | null {
  if (costMicros <= 0) return null;
  return Number((value / (costMicros / 1e6)).toFixed(3));
}

function cpc(costMicros: number, clicks: number): number | null {
  if (clicks <= 0) return null;
  return Number((costMicros / 1e6 / clicks).toFixed(4));
}

function ctr(clicks: number, impressions: number): number | null {
  if (impressions <= 0) return null;
  return Number(((clicks / impressions) * 100).toFixed(4));
}

function cvr(conversions: number, clicks: number): number | null {
  if (clicks <= 0) return null;
  return Number(((conversions / clicks) * 100).toFixed(4));
}

function aov(value: number, conversions: number): number | null {
  if (conversions <= 0) return null;
  return Number((value / conversions).toFixed(4));
}

function toChf(micros: number): number {
  return Number((micros / 1e6).toFixed(2));
}

function shapeTotals(raw: TotalsRow) {
  const a = aov(raw.value, raw.conversions);
  const cv = cvr(raw.conversions, raw.clicks);
  const cp = cpc(raw.cost, raw.clicks);
  const r = roas(raw.value, raw.cost);
  return {
    impressions: raw.impressions,
    clicks: raw.clicks,
    ctr: ctr(raw.clicks, raw.impressions),
    cpc: cp,
    spendChf: toChf(raw.cost),
    conversions: Number(raw.conversions.toFixed(2)),
    cvr: cv,
    valueChf: Number(raw.value.toFixed(2)),
    aov: a,
    roas: r,
    grossAdContributionChf: Number((raw.value * DEFAULT_GROSS_MARGIN - raw.cost / 1e6).toFixed(2)),
  };
}

async function totals(range: { start: string; end: string }): Promise<TotalsRow> {
  const rows = await prisma.$queryRaw<TotalsRow[]>(Prisma.sql`
    SELECT
      COALESCE(SUM("impressions"), 0)::float8 AS impressions,
      COALESCE(SUM("clicks"), 0)::float8 AS clicks,
      COALESCE(SUM("cost_micros"), 0)::float8 AS cost,
      COALESCE(SUM("conversions"), 0)::float8 AS conversions,
      COALESCE(SUM("conversion_value"), 0)::float8 AS value
    FROM "public"."ads_product_daily"
    WHERE "date" BETWEEN ${range.start}::date AND ${range.end}::date
  `);
  return rows[0] ?? { impressions: 0, clicks: 0, cost: 0, conversions: 0, value: 0 };
}

async function breakdown(range: { start: string; end: string }, dimensionSql: Prisma.Sql) {
  return prisma.$queryRaw<Array<{
    dim: string;
    impressions: number;
    clicks: number;
    cost: number;
    conversions: number;
    value: number;
    models: number;
  }>>(Prisma.sql`
    SELECT
      ${dimensionSql} AS dim,
      COALESCE(SUM("impressions"), 0)::float8 AS impressions,
      COALESCE(SUM("clicks"), 0)::float8 AS clicks,
      COALESCE(SUM("cost_micros"), 0)::float8 AS cost,
      COALESCE(SUM("conversions"), 0)::float8 AS conversions,
      COALESCE(SUM("conversion_value"), 0)::float8 AS value,
      COUNT(DISTINCT "shopify_product_id") FILTER (WHERE "shopify_product_id" IS NOT NULL)::int AS models
    FROM "public"."ads_product_daily"
    WHERE "date" BETWEEN ${range.start}::date AND ${range.end}::date
    GROUP BY ${dimensionSql}
  `);
}

async function modelPerf(range: { start: string; end: string }): Promise<ModelPerfRow[]> {
  return prisma.$queryRaw<ModelPerfRow[]>(Prisma.sql`
    SELECT
      "shopify_product_id"::text AS shopify_product_id,
      COALESCE(SUM("cost_micros"), 0)::float8 AS cost,
      COALESCE(SUM("conversions"), 0)::float8 AS conversions,
      COALESCE(SUM("conversion_value"), 0)::float8 AS value
    FROM "public"."ads_product_daily"
    WHERE "date" BETWEEN ${range.start}::date AND ${range.end}::date
      AND "shopify_product_id" IS NOT NULL
    GROUP BY "shopify_product_id"
  `);
}

function bridge(current: ReturnType<typeof shapeTotals>, prior: ReturnType<typeof shapeTotals>) {
  const aovP = prior.aov ?? 0;
  const cvrP = (prior.cvr ?? 0) / 100;
  const cpcP = prior.cpc ?? 0;
  const aovC = current.aov ?? 0;
  const cvrC = (current.cvr ?? 0) / 100;
  const cpcC = current.cpc ?? 0;

  if (cpcP <= 0 || cpcC <= 0) {
    return {
      priorRoas: prior.roas,
      aovEffect: null,
      cvrEffect: null,
      cpcEffect: null,
      reconciledCurrentRoas: current.roas,
      reconciliationError: null,
    };
  }

  const priorRoas = aovP * cvrP / cpcP;
  const aovEffect = (aovC - aovP) * cvrP / cpcP;
  const cvrEffect = aovC * (cvrC - cvrP) / cpcP;
  const cpcEffect = aovC * cvrC * (1 / cpcC - 1 / cpcP);
  const reconciled = priorRoas + aovEffect + cvrEffect + cpcEffect;
  return {
    priorRoas: Number(priorRoas.toFixed(6)),
    aovEffect: Number(aovEffect.toFixed(6)),
    cvrEffect: Number(cvrEffect.toFixed(6)),
    cpcEffect: Number(cpcEffect.toFixed(6)),
    reconciledCurrentRoas: Number(reconciled.toFixed(6)),
    actualCurrentRoas: current.roas,
    reconciliationError:
      current.roas != null ? Number((reconciled - current.roas).toFixed(6)) : null,
  };
}

function priceBandSql() {
  return Prisma.sql`
    CASE
      WHEN "shopify_product_id" IS NULL THEN '(unmapped)'
      WHEN "conversion_value" <= 0 THEN '(no_value)'
      WHEN ("conversion_value" / NULLIF("conversions", 0)) < 80 THEN '<80'
      WHEN ("conversion_value" / NULLIF("conversions", 0)) < 120 THEN '80-120'
      WHEN ("conversion_value" / NULLIF("conversions", 0)) < 180 THEN '120-180'
      WHEN ("conversion_value" / NULLIF("conversions", 0)) < 250 THEN '180-250'
      ELSE '250+'
    END
  `;
}

function shapeBreakdown(
  currentRows: Array<{ dim: string; impressions: number; clicks: number; cost: number; conversions: number; value: number; models: number }>,
  priorRows: Array<{ dim: string; impressions: number; clicks: number; cost: number; conversions: number; value: number; models: number }>
) {
  const priorByDim = new Map(priorRows.map((r) => [r.dim || "(empty)", r]));
  return currentRows
    .map((c) => {
      const dim = c.dim || "(empty)";
      const p = priorByDim.get(dim);
      const cur = shapeTotals(c);
      const pri = p ? shapeTotals(p) : null;
      return {
        dim,
        current: cur,
        prior: pri,
        roasDelta: pri?.roas != null && cur.roas != null ? Number((cur.roas - pri.roas).toFixed(3)) : null,
        spendDeltaChf: pri != null ? Number((cur.spendChf - pri.spendChf).toFixed(2)) : null,
        valueDeltaChf: pri != null ? Number((cur.valueChf - pri.valueChf).toFixed(2)) : null,
      };
    })
    .sort((a, b) => b.current.spendChf - a.current.spendChf);
}

/**
 * Absolute economic loss ranking.
 * expectedCurrentValue = currentSpend × priorRoas
 * lostConversionValue = expectedCurrentValue − actualCurrentValue
 * Rank by CHF lost, not ROAS points.
 */
function absoluteCampaignLoss(
  currentRows: Array<{ dim: string; impressions: number; clicks: number; cost: number; conversions: number; value: number; models: number }>,
  priorRows: Array<{ dim: string; impressions: number; clicks: number; cost: number; conversions: number; value: number; models: number }>
) {
  const priorByDim = new Map(priorRows.map((r) => [r.dim || "(empty)", r]));
  const dims = new Set([
    ...currentRows.map((r) => r.dim || "(empty)"),
    ...priorRows.map((r) => r.dim || "(empty)"),
  ]);

  return [...dims]
    .map((dim) => {
      const cRaw = currentRows.find((r) => (r.dim || "(empty)") === dim) ?? {
        dim,
        impressions: 0,
        clicks: 0,
        cost: 0,
        conversions: 0,
        value: 0,
        models: 0,
      };
      const pRaw = priorByDim.get(dim) ?? {
        dim,
        impressions: 0,
        clicks: 0,
        cost: 0,
        conversions: 0,
        value: 0,
        models: 0,
      };
      const cur = shapeTotals(cRaw);
      const pri = shapeTotals(pRaw);
      const expectedCurrentValueChf =
        pri.roas != null ? Number((cur.spendChf * pri.roas).toFixed(2)) : null;
      const lostConversionValueChf =
        expectedCurrentValueChf != null
          ? Number((expectedCurrentValueChf - cur.valueChf).toFixed(2))
          : null;
      const grossContributionDeltaChf = Number(
        (cur.grossAdContributionChf - pri.grossAdContributionChf).toFixed(2)
      );
      return {
        campaign: dim,
        prior: {
          spendChf: pri.spendChf,
          valueChf: pri.valueChf,
          roas: pri.roas,
          grossAdContributionChf: pri.grossAdContributionChf,
        },
        current: {
          spendChf: cur.spendChf,
          valueChf: cur.valueChf,
          roas: cur.roas,
          grossAdContributionChf: cur.grossAdContributionChf,
        },
        expectedCurrentValueChf,
        lostConversionValueChf,
        grossContributionDeltaChf,
        roasDelta:
          pri.roas != null && cur.roas != null ? Number((cur.roas - pri.roas).toFixed(3)) : null,
      };
    })
    .sort((a, b) => (b.lostConversionValueChf ?? -Infinity) - (a.lostConversionValueChf ?? -Infinity));
}

function continuingMix(currentModels: ModelPerfRow[], priorModels: ModelPerfRow[]) {
  const currentMap = new Map(currentModels.map((m) => [m.shopify_product_id, m]));
  const priorMap = new Map(priorModels.map((m) => [m.shopify_product_id, m]));
  const currentIds = new Set(currentMap.keys());
  const priorIds = new Set(priorMap.keys());
  const continuing = [...currentIds].filter((id) => priorIds.has(id));
  const newModels = [...currentIds].filter((id) => !priorIds.has(id));
  const lost = [...priorIds].filter((id) => !currentIds.has(id));

  const sum = (ids: string[], map: Map<string, ModelPerfRow>) => {
    let cost = 0;
    let value = 0;
    let conversions = 0;
    for (const id of ids) {
      const row = map.get(id);
      if (!row) continue;
      cost += row.cost;
      value += row.value;
      conversions += row.conversions;
    }
    return { modelCount: ids.length, cost, value, conversions, roas: roas(value, cost), spendChf: toChf(cost) };
  };

  const continuingCurrent = sum(continuing, currentMap);
  const continuingPrior = sum(continuing, priorMap);
  const allCurrent = sum([...currentIds], currentMap);
  const allPrior = sum([...priorIds], priorMap);

  return {
    continuingCurrent,
    continuingPrior,
    newModelsCurrent: sum(newModels, currentMap),
    lostModelsPrior: sum(lost, priorMap),
    effectDecomposition: {
      overallRoasDelta: allCurrent.roas != null && allPrior.roas != null ? Number((allCurrent.roas - allPrior.roas).toFixed(3)) : null,
      sameProductsPerformanceDelta:
        continuingCurrent.roas != null && continuingPrior.roas != null
          ? Number((continuingCurrent.roas - continuingPrior.roas).toFixed(3))
          : null,
      mixEffectApprox:
        allCurrent.roas != null && continuingCurrent.roas != null
          ? Number((allCurrent.roas - continuingCurrent.roas).toFixed(3))
          : null,
    },
  };
}

export async function diagnoseCommand(options: DiagnoseOptions = {}): Promise<number> {
  return withSyncRun("diagnose", options, async () => {
    const days = Math.max(7, Math.floor(options.days ?? 30));
    const end = defaultEndDate();
    const current = toRange(days, end);
    const prior = { start: addDays(current.start, -days), end: addDays(current.start, -1) };
    const yoy = { start: addDays(current.start, -365), end: addDays(current.end, -365) };

    const [curRaw, priRaw, yoyRaw] = await Promise.all([totals(current), totals(prior), totals(yoy)]);
    const cur = shapeTotals(curRaw);
    const pri = shapeTotals(priRaw);
    const yoyT = shapeTotals(yoyRaw);

    const [campaignCur, campaignPrior, brandCur, brandPrior, langCur, langPrior, attr0Cur, attr0Prior, attr1Cur, attr1Prior, typeCur, typePrior, priceCur, pricePrior, modelCurRows, modelPriorRows] =
      await Promise.all([
        breakdown(current, Prisma.sql`COALESCE(NULLIF("campaign_name", ''), '(empty)')`),
        breakdown(prior, Prisma.sql`COALESCE(NULLIF("campaign_name", ''), '(empty)')`),
        breakdown(current, Prisma.sql`COALESCE(NULLIF("brand", ''), '(empty)')`),
        breakdown(prior, Prisma.sql`COALESCE(NULLIF("brand", ''), '(empty)')`),
        breakdown(current, Prisma.sql`COALESCE(NULLIF("language_code", ''), '(empty)')`),
        breakdown(prior, Prisma.sql`COALESCE(NULLIF("language_code", ''), '(empty)')`),
        breakdown(current, Prisma.sql`COALESCE(NULLIF("custom_attr0", ''), '(empty)')`),
        breakdown(prior, Prisma.sql`COALESCE(NULLIF("custom_attr0", ''), '(empty)')`),
        breakdown(current, Prisma.sql`COALESCE(NULLIF("custom_attr1", ''), '(empty)')`),
        breakdown(prior, Prisma.sql`COALESCE(NULLIF("custom_attr1", ''), '(empty)')`),
        breakdown(current, Prisma.sql`COALESCE(NULLIF("product_type", ''), '(empty)')`),
        breakdown(prior, Prisma.sql`COALESCE(NULLIF("product_type", ''), '(empty)')`),
        breakdown(current, priceBandSql()),
        breakdown(prior, priceBandSql()),
        modelPerf(current),
        modelPerf(prior),
      ]);

    const campaignsByLostValue = absoluteCampaignLoss(campaignCur, campaignPrior);

    const report = {
      settings: {
        days,
        grossMargin: DEFAULT_GROSS_MARGIN,
        breakEvenRoas: Number((1 / DEFAULT_GROSS_MARGIN).toFixed(4)),
      },
      periods: { current, prior, yoy },
      totals: { current: cur, prior: pri, yoy: yoyT },
      roasBridgeAovCvrCpc: bridge(cur, pri),
      absoluteCampaignLoss: {
        note:
          "Ranked by lostConversionValueChf = currentSpend×priorRoas − actualCurrentValue. Prefer this over ROAS-point ranking for media impact.",
        campaigns: campaignsByLostValue,
      },
      decomposition: {
        campaign: shapeBreakdown(campaignCur, campaignPrior),
        brand: shapeBreakdown(brandCur, brandPrior),
        language: shapeBreakdown(langCur, langPrior),
        customAttr0: shapeBreakdown(attr0Cur, attr0Prior),
        customAttr1: shapeBreakdown(attr1Cur, attr1Prior),
        productType: shapeBreakdown(typeCur, typePrior),
        priceBand: shapeBreakdown(priceCur, pricePrior),
      },
      modelCohorts: continuingMix(modelCurRows, modelPriorRows),
      benchmarkApril2026: {
        sourceDate: "2026-04-23",
        submitted: 464682,
        approved: 464327,
        inStock: 455486,
        targeted: 339883,
        withImpressions: 35101,
        withClicks: 4621,
        note:
          "Le waterfall Google affiche 4266 engaged offers alors que la table source affiche 4621 with clicks. Ecart de 355. Benchmark conservé comme référence historique.",
      },
    };

    log("diagnose.summary", {
      periods: report.periods,
      current: report.totals.current,
      prior: report.totals.prior,
      bridge: report.roasBridgeAovCvrCpc,
      cohorts: report.modelCohorts.effectDecomposition,
      topCampaignsByLostValueChf: campaignsByLostValue.slice(0, 7).map((c) => ({
        campaign: c.campaign,
        lostConversionValueChf: c.lostConversionValueChf,
        grossContributionDeltaChf: c.grossContributionDeltaChf,
        priorRoas: c.prior.roas,
        currentRoas: c.current.roas,
        currentSpendChf: c.current.spendChf,
      })),
    });
    return report;
  });
}
