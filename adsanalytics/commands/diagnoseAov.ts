import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { Prisma } from "@prisma/client";

import { prisma } from "@/app/lib/prisma";
import { addDays, defaultEndDate } from "@/adsanalytics/dates";
import { stringifySafe } from "@/adsanalytics/json";
import { log, withSyncRun } from "@/adsanalytics/run";

type Options = { days?: number };

type Agg = {
  dim: string;
  conversions: number;
  value: number;
  models: number;
};

function toRange(days: number, end: string) {
  return { start: addDays(end, -(days - 1)), end };
}

function aov(value: number, conversions: number): number | null {
  if (conversions <= 0) return null;
  return Number((value / conversions).toFixed(2));
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

async function breakdown(range: { start: string; end: string }, dimSql: Prisma.Sql): Promise<Agg[]> {
  return prisma.$queryRaw<Agg[]>(Prisma.sql`
    SELECT
      ${dimSql} AS dim,
      COALESCE(SUM("conversions"), 0)::float8 AS conversions,
      COALESCE(SUM("conversion_value"), 0)::float8 AS value,
      COUNT(DISTINCT "shopify_product_id") FILTER (WHERE "shopify_product_id" IS NOT NULL)::int AS models
    FROM "public"."ads_product_daily"
    WHERE "date" BETWEEN ${range.start}::date AND ${range.end}::date
    GROUP BY ${dimSql}
  `);
}

function compareAov(current: Agg[], prior: Agg[]) {
  const priorMap = new Map(prior.map((r) => [r.dim || "(empty)", r]));
  const dims = new Set([...current.map((r) => r.dim || "(empty)"), ...prior.map((r) => r.dim || "(empty)")]);
  return [...dims]
    .map((dim) => {
      const c = current.find((r) => (r.dim || "(empty)") === dim) ?? {
        dim,
        conversions: 0,
        value: 0,
        models: 0,
      };
      const p = priorMap.get(dim) ?? { dim, conversions: 0, value: 0, models: 0 };
      const aovC = aov(c.value, c.conversions);
      const aovP = aov(p.value, p.conversions);
      const valueDelta = c.value - p.value;
      // contribution of AOV change holding prior conversion count:
      // approx = (aovC - aovP) * min(conversions)
      const aovEffectOnValue =
        aovC != null && aovP != null
          ? Number(((aovC - aovP) * Math.min(c.conversions, p.conversions || c.conversions)).toFixed(2))
          : null;
      return {
        dim,
        prior: {
          conversions: Number(p.conversions.toFixed(2)),
          valueChf: Number(p.value.toFixed(2)),
          aov: aovP,
          models: p.models,
        },
        current: {
          conversions: Number(c.conversions.toFixed(2)),
          valueChf: Number(c.value.toFixed(2)),
          aov: aovC,
          models: c.models,
        },
        aovDelta: aovC != null && aovP != null ? Number((aovC - aovP).toFixed(2)) : null,
        valueDeltaChf: Number(valueDelta.toFixed(2)),
        conversionsDelta: Number((c.conversions - p.conversions).toFixed(2)),
        approxAovEffectOnValueChf: aovEffectOnValue,
      };
    })
    .sort((a, b) => (a.aovDelta ?? 0) - (b.aovDelta ?? 0));
}

async function continuingModelAov(
  current: { start: string; end: string },
  prior: { start: string; end: string }
) {
  const rows = await prisma.$queryRaw<
    Array<{
      shopify_product_id: string;
      brand: string;
      prior_conversions: number;
      prior_value: number;
      current_conversions: number;
      current_value: number;
    }>
  >(Prisma.sql`
    WITH cur AS (
      SELECT
        "shopify_product_id"::text AS id,
        MAX("brand") AS brand,
        SUM("conversions")::float8 AS conversions,
        SUM("conversion_value")::float8 AS value
      FROM "public"."ads_product_daily"
      WHERE "date" BETWEEN ${current.start}::date AND ${current.end}::date
        AND "shopify_product_id" IS NOT NULL
      GROUP BY "shopify_product_id"
    ),
    pri AS (
      SELECT
        "shopify_product_id"::text AS id,
        MAX("brand") AS brand,
        SUM("conversions")::float8 AS conversions,
        SUM("conversion_value")::float8 AS value
      FROM "public"."ads_product_daily"
      WHERE "date" BETWEEN ${prior.start}::date AND ${prior.end}::date
        AND "shopify_product_id" IS NOT NULL
      GROUP BY "shopify_product_id"
    )
    SELECT
      cur.id AS shopify_product_id,
      COALESCE(NULLIF(cur.brand, ''), NULLIF(pri.brand, ''), '(empty)') AS brand,
      pri.conversions AS prior_conversions,
      pri.value AS prior_value,
      cur.conversions AS current_conversions,
      cur.value AS current_value
    FROM cur
    INNER JOIN pri ON pri.id = cur.id
    WHERE pri.conversions > 0 OR cur.conversions > 0
  `);

  const withAov = rows.map((r) => {
    const priorAov = aov(r.prior_value, r.prior_conversions);
    const currentAov = aov(r.current_value, r.current_conversions);
    return {
      shopifyProductId: r.shopify_product_id,
      brand: r.brand,
      prior: {
        conversions: Number(r.prior_conversions.toFixed(2)),
        valueChf: Number(r.prior_value.toFixed(2)),
        aov: priorAov,
      },
      current: {
        conversions: Number(r.current_conversions.toFixed(2)),
        valueChf: Number(r.current_value.toFixed(2)),
        aov: currentAov,
      },
      aovDelta:
        priorAov != null && currentAov != null ? Number((currentAov - priorAov).toFixed(2)) : null,
    };
  });

  const bothConverted = withAov.filter((r) => r.prior.conversions > 0 && r.current.conversions > 0);
  const cheaperSameModels = bothConverted.filter((r) => (r.aovDelta ?? 0) < -5);
  const aggregatePriorValue = bothConverted.reduce((s, r) => s + r.prior.valueChf, 0);
  const aggregatePriorConv = bothConverted.reduce((s, r) => s + r.prior.conversions, 0);
  const aggregateCurrentValue = bothConverted.reduce((s, r) => s + r.current.valueChf, 0);
  const aggregateCurrentConv = bothConverted.reduce((s, r) => s + r.current.conversions, 0);

  return {
    continuingModelsWithAnyConversion: withAov.length,
    continuingModelsWithConversionsBothPeriods: bothConverted.length,
    aggregate: {
      prior: {
        conversions: Number(aggregatePriorConv.toFixed(2)),
        valueChf: Number(aggregatePriorValue.toFixed(2)),
        aov: aov(aggregatePriorValue, aggregatePriorConv),
      },
      current: {
        conversions: Number(aggregateCurrentConv.toFixed(2)),
        valueChf: Number(aggregateCurrentValue.toFixed(2)),
        aov: aov(aggregateCurrentValue, aggregateCurrentConv),
      },
      aovDelta:
        aov(aggregateCurrentValue, aggregateCurrentConv) != null &&
        aov(aggregatePriorValue, aggregatePriorConv) != null
          ? Number(
              (
                aov(aggregateCurrentValue, aggregateCurrentConv)! -
                aov(aggregatePriorValue, aggregatePriorConv)!
              ).toFixed(2)
            )
          : null,
    },
    sameModelsSoldCheaperCount: cheaperSameModels.length,
    topAovDropModels: bothConverted
      .filter((r) => r.aovDelta != null)
      .sort((a, b) => (a.aovDelta ?? 0) - (b.aovDelta ?? 0))
      .slice(0, 25),
    topValueModelsCurrent: bothConverted
      .slice()
      .sort((a, b) => b.current.valueChf - a.current.valueChf)
      .slice(0, 25),
  };
}

async function attachShopifyPrices(
  models: Array<{ shopifyProductId: string }>
): Promise<
  Array<{
    shopifyProductId: string;
    shopifyCurrentPriceChf: number | null;
    shopifyCompareSampleCount: number;
  }>
> {
  if (models.length === 0) return [];
  const ids = models.map((m) => BigInt(m.shopifyProductId));
  const rows = await prisma.$queryRaw<
    Array<{ shopify_product_id: string; avg_price: number; n: number }>
  >(Prisma.sql`
    SELECT
      p."shopify_product_id"::text AS shopify_product_id,
      AVG(cls."lastPushedPrice")::float8 AS avg_price,
      COUNT(*)::int AS n
    FROM "public"."ads_shopping_product_current" p
    JOIN "public"."ChannelListingState" cls
      ON cls."channel" = 'SHOPIFY'
     AND cls."externalVariantId" = p."shopify_variant_id"::text
    WHERE p."is_current" = true
      AND p."shopify_product_id" IN (${Prisma.join(ids)})
      AND cls."lastPushedPrice" IS NOT NULL
    GROUP BY p."shopify_product_id"
  `);
  const map = new Map(rows.map((r) => [r.shopify_product_id, r]));
  return models.map((m) => {
    const hit = map.get(m.shopifyProductId);
    return {
      shopifyProductId: m.shopifyProductId,
      shopifyCurrentPriceChf: hit ? Number(hit.avg_price.toFixed(2)) : null,
      shopifyCompareSampleCount: hit?.n ?? 0,
    };
  });
}

async function mixShift(
  current: { start: string; end: string },
  prior: { start: string; end: string }
) {
  const bands = await Promise.all([
    breakdown(current, priceBandSql()),
    breakdown(prior, priceBandSql()),
  ]);
  const cur = bands[0];
  const pri = bands[1];
  const curConv = cur.reduce((s, r) => s + r.conversions, 0) || 1;
  const priConv = pri.reduce((s, r) => s + r.conversions, 0) || 1;
  const merged = compareAov(cur, pri).map((row) => ({
    ...row,
    priorSharePct: Number((((row.prior.conversions || 0) / priConv) * 100).toFixed(2)),
    currentSharePct: Number((((row.current.conversions || 0) / curConv) * 100).toFixed(2)),
    shareDeltaPp: Number(
      (
        ((row.current.conversions || 0) / curConv) * 100 -
        ((row.prior.conversions || 0) / priConv) * 100
      ).toFixed(2)
    ),
  }));
  return merged.sort((a, b) => b.shareDeltaPp - a.shareDeltaPp);
}

export async function diagnoseAovCommand(options: Options = {}): Promise<number> {
  return withSyncRun("diagnose:aov", options, async () => {
    const days = Math.max(7, Math.floor(options.days ?? 30));
    const end = defaultEndDate();
    const current = toRange(days, end);
    const prior = { start: addDays(current.start, -days), end: addDays(current.start, -1) };

    const [campaignCur, campaignPrior, brandCur, brandPrior, langCur, langPrior, modelCur, modelPrior, continuing, priceMix] =
      await Promise.all([
        breakdown(current, Prisma.sql`COALESCE(NULLIF("campaign_name", ''), '(empty)')`),
        breakdown(prior, Prisma.sql`COALESCE(NULLIF("campaign_name", ''), '(empty)')`),
        breakdown(current, Prisma.sql`COALESCE(NULLIF("brand", ''), '(empty)')`),
        breakdown(prior, Prisma.sql`COALESCE(NULLIF("brand", ''), '(empty)')`),
        breakdown(current, Prisma.sql`COALESCE(NULLIF("language_code", ''), '(empty)')`),
        breakdown(prior, Prisma.sql`COALESCE(NULLIF("language_code", ''), '(empty)')`),
        breakdown(current, Prisma.sql`COALESCE("shopify_product_id"::text, '(unmapped)')`),
        breakdown(prior, Prisma.sql`COALESCE("shopify_product_id"::text, '(unmapped)')`),
        continuingModelAov(current, prior),
        mixShift(current, prior),
      ]);

    const byCampaign = compareAov(campaignCur, campaignPrior);
    const byBrand = compareAov(brandCur, brandPrior);
    const byLanguage = compareAov(langCur, langPrior);
    const byModel = compareAov(modelCur, modelPrior)
      .filter((r) => (r.prior.conversions ?? 0) + (r.current.conversions ?? 0) > 0)
      .slice(0, 40);

    const priceSamples = await attachShopifyPrices(
      continuing.topAovDropModels.slice(0, 25).map((m) => ({ shopifyProductId: m.shopifyProductId }))
    );
    const priceById = new Map(priceSamples.map((p) => [p.shopifyProductId, p]));
    const topAovDropWithPrice = continuing.topAovDropModels.map((m) => ({
      ...m,
      shopifyCurrentPriceChf: priceById.get(m.shopifyProductId)?.shopifyCurrentPriceChf ?? null,
      adsAovVsShopifyPriceGapChf:
        m.current.aov != null && priceById.get(m.shopifyProductId)?.shopifyCurrentPriceChf != null
          ? Number(
              (
                m.current.aov - priceById.get(m.shopifyProductId)!.shopifyCurrentPriceChf!
              ).toFixed(2)
            )
          : null,
    }));

    // Hypothesis scoring
    const sameModelAovDrop = continuing.aggregate.aovDelta ?? 0;
    const lowBandShareGain =
      (priceMix.find((b) => b.dim === "<80")?.shareDeltaPp ?? 0) +
      (priceMix.find((b) => b.dim === "80-120")?.shareDeltaPp ?? 0);
    const highBandShareLoss =
      (priceMix.find((b) => b.dim === "250+")?.shareDeltaPp ?? 0) +
      (priceMix.find((b) => b.dim === "180-250")?.shareDeltaPp ?? 0);
    const trackingSuspectGaps = topAovDropWithPrice.filter(
      (m) =>
        m.shopifyCurrentPriceChf != null &&
        m.current.aov != null &&
        Math.abs(m.current.aov - m.shopifyCurrentPriceChf) > 80
    ).length;

    let primaryCause: string;
    const reasons: string[] = [];
    if (sameModelAovDrop < -15) {
      reasons.push("same_models_cheaper_or_lower_reported_value");
    }
    if (lowBandShareGain > 5 || highBandShareLoss < -5) {
      reasons.push("order_mix_shifted_to_cheaper_bands");
    }
    if (trackingSuspectGaps >= 3) {
      reasons.push("conversion_value_tracking_mismatch_vs_shopify_price");
    }
    if (reasons.length === 0) {
      primaryCause = "mixed_or_insufficient_signal";
    } else if (reasons.length === 1) {
      primaryCause = reasons[0]!;
    } else {
      primaryCause = `mixed:${reasons.join("+")}`;
    }

    const report = {
      periods: { current, prior },
      settings: {
        days,
        note: "Shopify current price from ChannelListingState(SHOPIFY).lastPushedPrice when variant mapped. Discount history not stored — cannot prove discount change, only current price vs ads AOV.",
      },
      decompositions: {
        campaign: byCampaign,
        brand: byBrand,
        language: byLanguage,
        priceBandMix: priceMix,
        soldModels: byModel,
        continuingModelsOnly: continuing,
      },
      topAovDropModelsWithShopifyPrice: topAovDropWithPrice,
      hypotheses: {
        sameModelsSoldCheaper: {
          continuingAovDelta: continuing.aggregate.aovDelta,
          modelsWithAovDropGt5: continuing.sameModelsSoldCheaperCount,
        },
        cheaperVariantsOrBandsSellingMore: {
          priceBandShareShifts: priceMix.map((b) => ({
            band: b.dim,
            shareDeltaPp: b.shareDeltaPp,
            aovDelta: b.aovDelta,
          })),
          lowBandShareGainPp: Number(lowBandShareGain.toFixed(2)),
          highBandShareLossPp: Number(highBandShareLoss.toFixed(2)),
        },
        conversionValuesMisreported: {
          modelsWithAdsAovFarFromShopifyPrice: trackingSuspectGaps,
          thresholdChf: 80,
        },
        orderMixChanged: {
          evidence: highBandShareLoss < -5 || lowBandShareGain > 5,
        },
        primaryCause,
      },
    };

    const outDir = path.join(process.cwd(), "tmp");
    await mkdir(outDir, { recursive: true });
    const outPath = path.join(outDir, `ads-diagnose-aov-${current.start}_${current.end}.json`);
    await writeFile(outPath, stringifySafe(report), "utf8");

    log("diagnose_aov.summary", {
      periods: report.periods,
      continuingAov: continuing.aggregate,
      primaryCause,
      topCampaignAovDrops: byCampaign.slice(0, 6).map((r) => ({
        dim: r.dim,
        aovDelta: r.aovDelta,
        valueDeltaChf: r.valueDeltaChf,
      })),
      topBrandAovDrops: byBrand.slice(0, 8).map((r) => ({
        dim: r.dim,
        aovDelta: r.aovDelta,
        valueDeltaChf: r.valueDeltaChf,
      })),
      exportPath: outPath,
    });

    return report;
  });
}
