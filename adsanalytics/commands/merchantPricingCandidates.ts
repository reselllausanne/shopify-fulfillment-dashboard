/**
 * Read-only constrained pricing candidates:
 * Ads-active SKUs → SupplierVariant/KickDB buy (margin floor) → Merchant CH benchmark
 * → best pocket×performance price. Never writes prices.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { Prisma } from "@prisma/client";

import { resolveMerchantId } from "@/adsanalytics/config";
import { stringifySafe } from "@/adsanalytics/json";
import {
  evaluateConstrainedCandidate,
  type ConstrainedCandidate,
} from "@/adsanalytics/merchant/constrainedPricing";
import { createMerchantPricingClient } from "@/adsanalytics/merchant/pricingClient";
import { parseMerchantProductId } from "@/adsanalytics/merchant/pricingNormalize";
import { log, withSyncRun } from "@/adsanalytics/run";
import { parseOfferId } from "@/adsanalytics/transform";
import { prisma } from "@/app/lib/prisma";

export type PricingCandidatesOptions = {
  account?: string;
  country?: string;
  /** Max Ads-active offers to evaluate. */
  limit?: number;
  thresholdPercent?: number;
  minImpressions?: number;
  examples?: number;
  /** Merchant competitiveness page size (joined by offer_id). */
  merchantLimit?: number;
};

type SeedOffer = {
  offer_id: string;
  shopify_variant_id: string;
  impressions: number;
  clicks: number;
  conversions: number;
  cost_micros: number;
};

type CostHit = {
  buyCostChf: number;
  lastPushedPrice: number | null;
  supplierVariantId: string | null;
  brand: string | null;
  productName: string | null;
  source: "channel_listing" | "gtin_supplier";
};

type BenchmarkHit = {
  currentPrice: number | null;
  benchmarkPrice: number | null;
  suggestedPrice: number | null;
  title: string | null;
  brand: string | null;
  predictedImpressionsChange: number | null;
  predictedClicksChange: number | null;
  predictedConversionsChange: number | null;
};

export type CandidateRow = {
  title: string | null;
  brand: string | null;
  offerId: string;
  shopifyVariantId: string;
  merchantCurrent: number | null;
  shopifyPushed: number | null;
  buyCostChf: number | null;
  costSource: CostHit["source"] | "none";
  benchmark: number | null;
  ads30d: { impressions: number; clicks: number; conversions: number; costChf: number };
  result: ConstrainedCandidate;
};

function round2(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function gid(variantId: string): string {
  return variantId.startsWith("gid://")
    ? variantId
    : `gid://shopify/ProductVariant/${variantId}`;
}

async function loadAdsActiveSeeds(limit: number, minImpressions: number): Promise<SeedOffer[]> {
  return prisma.$queryRaw<SeedOffer[]>(Prisma.sql`
    SELECT
      MAX("offer_id") AS offer_id,
      MAX("shopify_variant_id")::text AS shopify_variant_id,
      COALESCE(SUM("impressions"), 0)::float AS impressions,
      COALESCE(SUM("clicks"), 0)::float AS clicks,
      COALESCE(SUM("conversions"), 0)::float AS conversions,
      COALESCE(SUM("cost_micros"), 0)::float AS cost_micros
    FROM "public"."ads_product_daily"
    WHERE "date" >= (CURRENT_DATE - INTERVAL '30 days')
      AND "shopify_variant_id" IS NOT NULL
      AND "offer_id" <> ''
    GROUP BY "shopify_variant_id"
    HAVING COALESCE(SUM("impressions"), 0) >= ${minImpressions}
        OR COALESCE(SUM("clicks"), 0) >= 1
        OR COALESCE(SUM("cost_micros"), 0) >= 1000000
    ORDER BY COALESCE(SUM("impressions"), 0) DESC
    LIMIT ${limit}
  `);
}

async function loadBuyCosts(variantIds: string[]): Promise<Map<string, CostHit>> {
  const ids = Array.from(new Set(variantIds.map((v) => v.trim()).filter(Boolean)));
  const map = new Map<string, CostHit>();
  if (ids.length === 0) return map;

  const gids = ids.map(gid);

  const clsRows = await prisma.$queryRaw<
    Array<{
      vid: string;
      buy: number;
      pushed: number | null;
      supplier_variant_id: string;
      brand: string | null;
      product_name: string | null;
    }>
  >(Prisma.sql`
    SELECT
      REGEXP_REPLACE(cls."externalVariantId", '^.*\\/', '') AS vid,
      COALESCE(
        NULLIF(sv."expressBuyPrice", 0),
        NULLIF(sv."price", 0),
        NULLIF(sv."standardBuyPrice", 0)
      )::float8 AS buy,
      cls."lastPushedPrice"::float8 AS pushed,
      sv."supplierVariantId" AS supplier_variant_id,
      sv."supplierBrand" AS brand,
      sv."supplierProductName" AS product_name
    FROM "public"."ChannelListingState" cls
    JOIN "public"."SupplierVariant" sv
      ON sv."supplierVariantId" = cls."supplierVariantId"
    WHERE cls."channel" = 'SHOPIFY'
      AND (
        cls."externalVariantId" IN (${Prisma.join(ids)})
        OR cls."externalVariantId" IN (${Prisma.join(gids)})
      )
      AND COALESCE(
        NULLIF(sv."expressBuyPrice", 0),
        NULLIF(sv."price", 0),
        NULLIF(sv."standardBuyPrice", 0)
      ) IS NOT NULL
  `);

  for (const row of clsRows) {
    if (row.buy > 0) {
      map.set(row.vid, {
        buyCostChf: row.buy,
        lastPushedPrice: row.pushed,
        supplierVariantId: row.supplier_variant_id,
        brand: row.brand,
        productName: row.product_name,
        source: "channel_listing",
      });
    }
  }

  const missing = ids.filter((id) => !map.has(id));
  if (missing.length === 0) return map;

  const missingGids = missing.map(gid);
  const gtinRows = await prisma.$queryRaw<
    Array<{
      vid: string;
      buy: number;
      supplier_variant_id: string;
      brand: string | null;
      product_name: string | null;
    }>
  >(Prisma.sql`
    SELECT DISTINCT ON (vid)
      REGEXP_REPLACE(s."shopifyVariantId", '^.*\\/', '') AS vid,
      COALESCE(
        NULLIF(sv."expressBuyPrice", 0),
        NULLIF(sv."price", 0),
        NULLIF(sv."standardBuyPrice", 0)
      )::float8 AS buy,
      sv."supplierVariantId" AS supplier_variant_id,
      sv."supplierBrand" AS brand,
      sv."supplierProductName" AS product_name
    FROM "public"."ShopifyVariantLocationStock" s
    JOIN "public"."SupplierVariant" sv
      ON sv.gtin = s.gtin
     AND (
       sv."supplierVariantId" ILIKE 'stx_%'
       OR UPPER(COALESCE(sv."providerKey", '')) LIKE 'STX_%'
     )
    WHERE s."shopifyVariantId" IN (${Prisma.join(missing.concat(missingGids))})
      AND s.gtin IS NOT NULL
      AND s.gtin <> ''
      AND COALESCE(
        NULLIF(sv."expressBuyPrice", 0),
        NULLIF(sv."price", 0),
        NULLIF(sv."standardBuyPrice", 0)
      ) IS NOT NULL
    ORDER BY vid, sv."updatedAt" DESC NULLS LAST
  `);

  for (const row of gtinRows) {
    if (!map.has(row.vid) && row.buy > 0) {
      map.set(row.vid, {
        buyCostChf: row.buy,
        lastPushedPrice: null,
        supplierVariantId: row.supplier_variant_id,
        brand: row.brand,
        productName: row.product_name,
        source: "gtin_supplier",
      });
    }
  }

  return map;
}

function indexBenchmarks(
  competitivenessRows: Array<{
    offerId: string | null;
    merchantProductId: string;
    title: string | null;
    brand: string | null;
    currentPrice: number | null;
    benchmarkPrice: number | null;
  }>,
  insightsRows: Array<{
    offerId: string | null;
    merchantProductId: string;
    suggestedPrice: number | null;
    predictedImpressionsChange: number | null;
    predictedClicksChange: number | null;
    predictedConversionsChange: number | null;
  }>
): Map<string, BenchmarkHit> {
  const map = new Map<string, BenchmarkHit>();

  const keyOf = (offerId: string | null, merchantProductId: string) => {
    if (offerId && offerId.trim()) return offerId.trim().toLowerCase();
    const parsed = parseMerchantProductId(merchantProductId);
    return (parsed.offerId ?? merchantProductId).toLowerCase();
  };

  for (const row of competitivenessRows) {
    const key = keyOf(row.offerId, row.merchantProductId);
    map.set(key, {
      currentPrice: row.currentPrice,
      benchmarkPrice: row.benchmarkPrice,
      suggestedPrice: null,
      title: row.title,
      brand: row.brand,
      predictedImpressionsChange: null,
      predictedClicksChange: null,
      predictedConversionsChange: null,
    });
  }

  for (const row of insightsRows) {
    const key = keyOf(row.offerId, row.merchantProductId);
    const existing = map.get(key);
    if (existing) {
      existing.suggestedPrice = row.suggestedPrice;
      existing.predictedImpressionsChange = row.predictedImpressionsChange;
      existing.predictedClicksChange = row.predictedClicksChange;
      existing.predictedConversionsChange = row.predictedConversionsChange;
    } else {
      map.set(key, {
        currentPrice: null,
        benchmarkPrice: null,
        suggestedPrice: row.suggestedPrice,
        title: null,
        brand: null,
        predictedImpressionsChange: row.predictedImpressionsChange,
        predictedClicksChange: row.predictedClicksChange,
        predictedConversionsChange: row.predictedConversionsChange,
      });
    }
  }

  return map;
}

function printRow(label: string, row: CandidateRow): void {
  const r = row.result;
  console.info("");
  console.info(`[${label}] ${row.title ?? "(no title)"}`);
  console.info(`  brand=${row.brand ?? "?"} offer=${row.offerId}`);
  console.info(
    `  current=${r.currentPrice}  floor=${r.marginFloorChf ?? "—"}  buy=${row.buyCostChf ?? "—"} (${row.costSource})  benchmark=${row.benchmark ?? "—"}`
  );
  console.info(
    `  best=${r.bestPriceChf ?? "—"}  delta=${r.deltaVsCurrentChf ?? "—"}  pocket ${r.currentPocketChf ?? "—"} → ${r.bestPocketChf ?? "—"}  scoreΔ=${r.scoreImprovementPct ?? "—"}%`
  );
  console.info(
    `  ads30d imp=${row.ads30d.impressions} clk=${row.ads30d.clicks} conv=${row.ads30d.conversions} cost=${row.ads30d.costChf}`
  );
  console.info(`  why: ${r.why}`);
}

export async function merchantPricingCandidatesCommand(
  options: PricingCandidatesOptions = {}
): Promise<number> {
  const account = resolveMerchantId(options.account);
  const country = (options.country ?? "CH").trim().toUpperCase() || "CH";
  const limit = Math.max(1, Math.min(options.limit ?? 150, 1000));
  const merchantLimit = Math.max(limit, Math.min(options.merchantLimit ?? 2000, 5000));
  const threshold = Math.max(1, options.thresholdPercent ?? 8);
  const minImpressions = Math.max(0, options.minImpressions ?? 50);
  const exampleN = Math.max(1, Math.min(options.examples ?? 8, 25));

  return withSyncRun(
    "merchant:pricing-candidates",
    {
      account,
      country,
      limit,
      merchantLimit,
      threshold,
      minImpressions,
      exampleN,
      readOnly: true,
      mutatePrices: false,
    },
    async () => {
      const seeds = await loadAdsActiveSeeds(limit, minImpressions);
      const costs = await loadBuyCosts(seeds.map((s) => s.shopify_variant_id));

      const client = createMerchantPricingClient(account);
      const connection = await client.testConnection();
      if (!connection.ok) {
        throw new Error(`Merchant connection failed: ${connection.status}`);
      }

      // Prefer targeted Merchant lookups for Ads-active offer ids (bulk sample misses them).
      const [competitiveness, insights] = await Promise.all([
        client.getPriceCompetitivenessForOffers({
          countryCode: country,
          offerIds: seeds.map((s) => s.offer_id),
          concurrency: 6,
        }),
        client.getPriceInsights({ countryCode: country, limit: Math.min(500, merchantLimit) }),
      ]);

      const benchmarks = indexBenchmarks(competitiveness.rows, insights.rows);

      const rows: CandidateRow[] = [];
      for (const seed of seeds) {
        const parsed = parseOfferId(seed.offer_id);
        const variantId =
          seed.shopify_variant_id ||
          (parsed.shopifyVariantId != null ? String(parsed.shopifyVariantId) : "");
        const cost = costs.get(variantId);
        const bench =
          benchmarks.get(seed.offer_id.toLowerCase()) ??
          (seed.offer_id.includes("_")
            ? benchmarks.get(seed.offer_id.toLowerCase().replace("shopify_ch_", "shopify_ch_"))
            : undefined);

        // Also try Merchant-cased offer id
        const bench2 =
          bench ??
          benchmarks.get(seed.offer_id.replace(/^shopify_ch_/i, "shopify_CH_").toLowerCase());

        const bm = bench2 ?? bench ?? null;
        const ads30d = {
          impressions: seed.impressions,
          clicks: seed.clicks,
          conversions: seed.conversions,
          costChf: seed.cost_micros / 1e6,
        };

        const current = bm?.currentPrice ?? cost?.lastPushedPrice ?? null;
        if (current == null || !(current > 0)) {
          rows.push({
            title: bm?.title ?? cost?.productName ?? null,
            brand: bm?.brand ?? cost?.brand ?? null,
            offerId: seed.offer_id,
            shopifyVariantId: variantId,
            merchantCurrent: round2(bm?.currentPrice ?? null),
            shopifyPushed: round2(cost?.lastPushedPrice ?? null),
            buyCostChf: round2(cost?.buyCostChf ?? null),
            costSource: cost?.source ?? "none",
            benchmark: round2(bm?.benchmarkPrice ?? null),
            ads30d: {
              impressions: Math.round(ads30d.impressions),
              clicks: Math.round(ads30d.clicks),
              conversions: Number(ads30d.conversions.toFixed(2)),
              costChf: round2(ads30d.costChf) ?? 0,
            },
            result: {
              verdict: bm?.benchmarkPrice == null ? "skip_no_benchmark" : "skip_invalid_price",
              why:
                bm?.benchmarkPrice == null
                  ? "Ads-active but no Merchant CH competitiveness row for this offer_id."
                  : "No usable current sell price (Merchant + Shopify pushed both missing).",
              currentPrice: 0,
              buyCostChf: cost?.buyCostChf ?? null,
              marginFloorChf: null,
              benchmarkPrice: bm?.benchmarkPrice ?? null,
              suggestedPrice: bm?.suggestedPrice ?? null,
              bestPriceChf: null,
              deltaVsCurrentChf: null,
              currentPocketChf: null,
              bestPocketChf: null,
              currentPerformanceScore: null,
              bestPerformanceScore: null,
              scoreImprovementPct: null,
              adsAlive: true,
              headroomToFloorChf: null,
              canReachBenchmark: null,
            },
          });
          continue;
        }

        const result = evaluateConstrainedCandidate({
          currentPrice: current,
          benchmarkPrice: bm?.benchmarkPrice ?? null,
          suggestedPrice: bm?.suggestedPrice ?? null,
          buyCostChf: cost?.buyCostChf ?? null,
          brand: bm?.brand ?? cost?.brand,
          title: bm?.title ?? cost?.productName,
          ads: ads30d,
          predictedImpressionsChange: bm?.predictedImpressionsChange,
          predictedClicksChange: bm?.predictedClicksChange,
          predictedConversionsChange: bm?.predictedConversionsChange,
          gapThresholdPercent: threshold,
          minImpressions,
          isExpress: true,
        });

        rows.push({
          title: bm?.title ?? cost?.productName ?? null,
          brand: bm?.brand ?? cost?.brand ?? null,
          offerId: seed.offer_id,
          shopifyVariantId: variantId,
          merchantCurrent: round2(bm?.currentPrice ?? null),
          shopifyPushed: round2(cost?.lastPushedPrice ?? null),
          buyCostChf: round2(cost?.buyCostChf ?? null),
          costSource: cost?.source ?? "none",
          benchmark: round2(bm?.benchmarkPrice ?? null),
          ads30d: {
            impressions: Math.round(ads30d.impressions),
            clicks: Math.round(ads30d.clicks),
            conversions: Number(ads30d.conversions.toFixed(2)),
            costChf: round2(ads30d.costChf) ?? 0,
          },
          result: {
            ...result,
            currentPrice: round2(result.currentPrice) ?? result.currentPrice,
            buyCostChf: round2(result.buyCostChf),
            marginFloorChf: round2(result.marginFloorChf),
            benchmarkPrice: round2(result.benchmarkPrice),
            suggestedPrice: round2(result.suggestedPrice),
            bestPriceChf: round2(result.bestPriceChf),
            deltaVsCurrentChf: round2(result.deltaVsCurrentChf),
            currentPocketChf: round2(result.currentPocketChf),
            bestPocketChf: round2(result.bestPocketChf),
            headroomToFloorChf: round2(result.headroomToFloorChf),
          },
        });
      }

      const counts: Record<string, number> = {};
      for (const row of rows) {
        counts[row.result.verdict] = (counts[row.result.verdict] ?? 0) + 1;
      }

      const byImprove = (a: CandidateRow, b: CandidateRow) =>
        Math.abs(b.result.scoreImprovementPct ?? 0) - Math.abs(a.result.scoreImprovementPct ?? 0) ||
        (b.ads30d.impressions - a.ads30d.impressions);

      const lower = rows
        .filter((r) => r.result.verdict === "recommend_lower")
        .sort(byImprove)
        .slice(0, exampleN);
      const raise = rows
        .filter((r) => r.result.verdict === "recommend_raise")
        .sort(byImprove)
        .slice(0, exampleN);
      const hold = rows
        .filter((r) => r.result.verdict === "hold")
        .sort((a, b) => b.ads30d.impressions - a.ads30d.impressions)
        .slice(0, exampleN);
      const noHeadroom = rows
        .filter((r) => r.result.verdict === "skip_no_headroom")
        .sort((a, b) => b.ads30d.impressions - a.ads30d.impressions)
        .slice(0, exampleN);
      const blocked = rows
        .filter((r) =>
          ["skip_dead_sku", "skip_no_cost", "skip_no_benchmark"].includes(r.result.verdict)
        )
        .sort((a, b) => b.ads30d.impressions - a.ads30d.impressions)
        .slice(0, exampleN);

      const report = {
        timestamp: new Date().toISOString(),
        merchantCenterAccountId: account,
        country,
        adsActiveSampled: rows.length,
        merchantCompetitivenessRows: competitiveness.rows.length,
        merchantInsightsRows: insights.rows.length,
        thresholdPercent: threshold,
        minImpressions,
        mutatePrices: false,
        externalMutations: false,
        note:
          "Starts from Ads-active SKUs. Buy cost from ChannelListingState (GID) or GTIN→STX SupplierVariant (KickDB-fed). Best price maximizes pocket×demand under Shopify margin floor — never raw benchmark alone.",
        counts,
        examples: {
          recommend_lower: lower,
          recommend_raise: raise,
          hold,
          skip_no_headroom: noHeadroom,
          blocked,
        },
      };

      const outDir = path.join(process.cwd(), "tmp");
      await mkdir(outDir, { recursive: true });
      const outPath = path.join(outDir, "merchant-pricing-candidates.json");
      await writeFile(outPath, stringifySafe(report), "utf8");

      console.info("");
      console.info("=== READ-ONLY constrained candidates (no prices changed) ===");
      console.info(
        `Ads-active ${rows.length} | Merchant CH bench rows ${competitiveness.rows.length} | threshold ±${threshold}% | minImp ${minImpressions}`
      );
      console.info(`Counts: ${JSON.stringify(counts)}`);

      for (const row of lower) printRow("LOWER", row);
      for (const row of raise) printRow("RAISE", row);
      for (const row of noHeadroom) printRow("NO_HEADROOM", row);
      for (const row of hold) printRow("HOLD", row);
      for (const row of blocked) printRow(`BLOCKED:${row.result.verdict}`, row);

      console.info("");
      console.info("No Shopify / Merchant / Ads / feed prices modified.");
      console.info(`Report: ${outPath}`);

      log("merchant_pricing_candidates.summary", {
        account,
        adsActiveSampled: rows.length,
        counts,
        reportPath: outPath,
        mutatePrices: false,
      });

      return {
        adsActiveSampled: rows.length,
        counts,
        reportPath: outPath,
        mutatePrices: false,
      };
    }
  );
}
