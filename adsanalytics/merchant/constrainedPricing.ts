/**
 * Constrained pricing candidates — read-only.
 *
 * Rules baked in from ops:
 * - Sell is firm: never propose cutting to raw Google benchmark alone.
 * - Need buy cost (KickDB / SupplierVariant) → margin floor via Shopify fee model.
 * - Dead SKUs (no Ads activity) → skip; lowering won't help performance.
 * - Pick price maximizing approx (pocket × demand), clamped to [marginFloor, …].
 */

import { psychRoundUp } from "@/galaxus/pricing/suggestedSellPrice";
import { calcShopifySellPriceFromCost } from "@/shopify/pricing/calcShopifySellPrice";

export type AdsActivity = {
  impressions: number;
  clicks: number;
  conversions: number;
  costChf: number;
};

export type ConstraintInput = {
  currentPrice: number;
  benchmarkPrice: number | null;
  suggestedPrice: number | null;
  buyCostChf: number | null;
  brand?: string | null;
  title?: string | null;
  productHandle?: string | null;
  ads: AdsActivity;
  predictedImpressionsChange?: number | null;
  predictedClicksChange?: number | null;
  predictedConversionsChange?: number | null;
  /** Min |gap|% vs benchmark to consider a move. */
  gapThresholdPercent?: number;
  /** Min Ads impressions (30d) to treat SKU as alive. */
  minImpressions?: number;
  isExpress?: boolean;
};

export type CandidateVerdict =
  | "recommend_lower"
  | "recommend_raise"
  | "hold"
  | "skip_dead_sku"
  | "skip_no_cost"
  | "skip_no_benchmark"
  | "skip_no_headroom"
  | "skip_invalid_price";

export type ConstrainedCandidate = {
  verdict: CandidateVerdict;
  why: string;
  currentPrice: number;
  buyCostChf: number | null;
  marginFloorChf: number | null;
  benchmarkPrice: number | null;
  suggestedPrice: number | null;
  /** Best scored price under constraints (null if skip/hold with no move). */
  bestPriceChf: number | null;
  deltaVsCurrentChf: number | null;
  currentPocketChf: number | null;
  bestPocketChf: number | null;
  currentPerformanceScore: number | null;
  bestPerformanceScore: number | null;
  scoreImprovementPct: number | null;
  adsAlive: boolean;
  headroomToFloorChf: number | null;
  canReachBenchmark: boolean | null;
};

const PSP = 0.032;
const VAT = 0.023;
const ADS_PCT = 0.19;

export function estimateNetPocketChf(
  sellChf: number,
  buyCostChf: number,
  isExpress = true
): number | null {
  if (!Number.isFinite(sellChf) || sellChf <= 0) return null;
  if (!Number.isFinite(buyCostChf) || buyCostChf <= 0) return null;
  const ship = isExpress ? 15.0 : 14.5;
  // Matches storefront hybrid fee stack used in calcShopifySellPrice (variable ads %).
  return sellChf * (1 - PSP - VAT - ADS_PCT) - ship - buyCostChf;
}

export function computeMarginFloorChf(input: {
  buyCostChf: number;
  brand?: string | null;
  title?: string | null;
  productHandle?: string | null;
  isExpress?: boolean;
}): number | null {
  return calcShopifySellPriceFromCost({
    costChf: input.buyCostChf,
    brand: input.brand,
    productName: input.title,
    productHandle: input.productHandle,
    isExpress: input.isExpress ?? true,
  });
}

export function isAdsAlive(
  ads: AdsActivity,
  minImpressions = 20
): boolean {
  return (
    ads.impressions >= minImpressions ||
    ads.clicks >= 1 ||
    ads.costChf >= 1 ||
    ads.conversions > 0
  );
}

/**
 * Relative demand vs current price.
 * Prefer Merchant Price Insights fractions when present; else gap heuristic:
 * moving toward CH benchmark improves demand; moving away hurts.
 */
export function relativeDemandVsCurrent(
  candidatePrice: number,
  currentPrice: number,
  benchmarkPrice: number | null,
  predictions?: {
    impressions?: number | null;
    clicks?: number | null;
    conversions?: number | null;
  }
): number {
  if (!(candidatePrice > 0) || !(currentPrice > 0)) return 1;

  const pred =
    predictions?.conversions ?? predictions?.clicks ?? predictions?.impressions ?? null;

  if (
    pred != null &&
    Number.isFinite(pred) &&
    benchmarkPrice != null &&
    benchmarkPrice > 0 &&
    Math.abs(currentPrice - benchmarkPrice) > 0.5
  ) {
    // Insights fractions are vs applying suggested price. Interpolate by how far
    // candidate travels from current toward suggested/benchmark path.
    const anchor = predictions && (predictions as { _suggested?: number })._suggested;
    void anchor;
    const target = benchmarkPrice;
    const travel = (currentPrice - candidatePrice) / (currentPrice - target);
    const t = Math.max(0, Math.min(1, travel));
    // pred is fraction change at full move to suggestion; scale linearly.
    return Math.max(0.05, 1 + pred * t);
  }

  if (benchmarkPrice == null || benchmarkPrice <= 0) return 1;

  const gapNow = (currentPrice - benchmarkPrice) / benchmarkPrice;
  const gapCand = (candidatePrice - benchmarkPrice) / benchmarkPrice;
  // Soft elasticity: 10pp closer to market from above ≈ +8% demand; below market mild.
  const improve = gapNow - gapCand; // positive when candidate closer to / under market from above
  return Math.max(0.05, Math.min(2.5, Math.exp(0.8 * improve)));
}

export function performanceScore(input: {
  price: number;
  buyCostChf: number;
  benchmarkPrice: number | null;
  currentPrice: number;
  ads: AdsActivity;
  isExpress?: boolean;
  predictions?: {
    impressions?: number | null;
    clicks?: number | null;
    conversions?: number | null;
  };
}): number | null {
  const pocket = estimateNetPocketChf(input.price, input.buyCostChf, input.isExpress ?? true);
  if (pocket == null || pocket <= 0) return null;

  const demand = relativeDemandVsCurrent(
    input.price,
    input.currentPrice,
    input.benchmarkPrice,
    input.predictions
  );

  // Traffic weight: dead already filtered; log1p so whales don't dominate exclusively.
  const traffic = Math.log1p(input.ads.impressions) + 2 * Math.log1p(input.ads.clicks) + 5 * input.ads.conversions;
  const trafficW = Math.max(0.2, traffic);

  // Expected contribution proxy.
  return pocket * demand * trafficW;
}

function buildPriceGrid(lo: number, hi: number): number[] {
  if (!(lo > 0) || !(hi > 0) || hi < lo) return [];
  const out = new Set<number>();
  out.add(psychRoundUp(lo));
  out.add(psychRoundUp(hi));
  // CHF steps denser near market; coarse grid otherwise.
  const span = hi - lo;
  const step = span > 80 ? 10 : span > 30 ? 5 : 2;
  for (let p = lo; p <= hi + 1e-9; p += step) {
    out.add(psychRoundUp(p));
  }
  return Array.from(out)
    .filter((p) => p >= lo - 0.5 && p <= hi + 0.5)
    .sort((a, b) => a - b);
}

export function evaluateConstrainedCandidate(input: ConstraintInput): ConstrainedCandidate {
  const threshold = input.gapThresholdPercent ?? 8;
  const minImp = input.minImpressions ?? 20;
  const isExpress = input.isExpress ?? true;
  const current = input.currentPrice;

  const base = {
    currentPrice: current,
    buyCostChf: input.buyCostChf,
    marginFloorChf: null as number | null,
    benchmarkPrice: input.benchmarkPrice,
    suggestedPrice: input.suggestedPrice,
    bestPriceChf: null as number | null,
    deltaVsCurrentChf: null as number | null,
    currentPocketChf: null as number | null,
    bestPocketChf: null as number | null,
    currentPerformanceScore: null as number | null,
    bestPerformanceScore: null as number | null,
    scoreImprovementPct: null as number | null,
    adsAlive: isAdsAlive(input.ads, minImp),
    headroomToFloorChf: null as number | null,
    canReachBenchmark: null as boolean | null,
  };

  if (!Number.isFinite(current) || current <= 0) {
    return { ...base, verdict: "skip_invalid_price", why: "Invalid current sell price." };
  }
  if (input.benchmarkPrice == null || !(input.benchmarkPrice > 0)) {
    return { ...base, verdict: "skip_no_benchmark", why: "No CH benchmark — cannot score vs market." };
  }
  if (!base.adsAlive) {
    return {
      ...base,
      verdict: "skip_dead_sku",
      why: `Dead/low-signal SKU (ads30d imp=${input.ads.impressions}, clk=${input.ads.clicks}). Lowering won't add Shopping performance.`,
    };
  }
  if (input.buyCostChf == null || !(input.buyCostChf > 0)) {
    return {
      ...base,
      verdict: "skip_no_cost",
      why: "No KickDB/SupplierVariant buy cost — cannot know margin headroom. Firm price stays.",
    };
  }

  const floor = computeMarginFloorChf({
    buyCostChf: input.buyCostChf,
    brand: input.brand,
    title: input.title,
    productHandle: input.productHandle,
    isExpress,
  });
  base.marginFloorChf = floor;
  if (floor == null) {
    return { ...base, verdict: "skip_no_cost", why: "Margin floor could not be computed from buy cost." };
  }

  base.headroomToFloorChf = Math.round((current - floor) * 100) / 100;
  base.canReachBenchmark = floor <= input.benchmarkPrice + 0.5;
  base.currentPocketChf = estimateNetPocketChf(current, input.buyCostChf, isExpress);

  const predictions = {
    impressions: input.predictedImpressionsChange,
    clicks: input.predictedClicksChange,
    conversions: input.predictedConversionsChange,
  };

  const scoreAt = (price: number) =>
    performanceScore({
      price,
      buyCostChf: input.buyCostChf!,
      benchmarkPrice: input.benchmarkPrice,
      currentPrice: current,
      ads: input.ads,
      isExpress,
      predictions,
    });

  const currentScore = scoreAt(current);
  base.currentPerformanceScore = currentScore;

  const gapPct = ((current - input.benchmarkPrice) / input.benchmarkPrice) * 100;

  // --- Above market: only lower inside [floor, current], never below floor ---
  if (gapPct >= threshold) {
    if (current <= floor + 0.5) {
      return {
        ...base,
        verdict: "skip_no_headroom",
        why: `Above market (+${gapPct.toFixed(1)}%) but already at/below margin floor (${floor} CHF). Firm price — cannot lower safely.`,
      };
    }

    const lo = floor;
    const hi = current;
    const grid = buildPriceGrid(lo, hi);
    let bestP = current;
    let bestS = currentScore ?? -Infinity;

    for (const p of grid) {
      if (p > current + 0.01) continue;
      if (p < floor - 0.01) continue;
      const pocket = estimateNetPocketChf(p, input.buyCostChf, isExpress);
      if (pocket == null || pocket <= 0) continue;
      const s = scoreAt(p);
      if (s == null) continue;
      if (s > bestS + 1e-9 || (Math.abs(s - bestS) <= 1e-9 && p < bestP)) {
        bestS = s;
        bestP = p;
      }
    }

    // Prefer anchoring near min(current, max(floor, benchmark|suggested)) if score close.
    const marketAnchor = Math.max(
      floor,
      Math.min(
        current,
        input.suggestedPrice && input.suggestedPrice > 0
          ? input.suggestedPrice
          : input.benchmarkPrice
      )
    );
    const anchor = psychRoundUp(marketAnchor);
    if (anchor >= floor && anchor <= current) {
      const sAnchor = scoreAt(anchor);
      if (sAnchor != null && sAnchor >= bestS * 0.98) {
        bestP = anchor;
        bestS = sAnchor;
      }
    }

    if (bestP >= current - 0.5) {
      return {
        ...base,
        verdict: "hold",
        why: `Above market (+${gapPct.toFixed(1)}%) but best score stays at current after margin+demand constraints${
          base.canReachBenchmark ? "" : ` (margin floor ${floor} > benchmark ${input.benchmarkPrice} — cannot match market)`
        }.`,
        bestPriceChf: current,
        deltaVsCurrentChf: 0,
        bestPocketChf: base.currentPocketChf,
        bestPerformanceScore: currentScore,
        scoreImprovementPct: 0,
      };
    }

    const bestPocket = estimateNetPocketChf(bestP, input.buyCostChf, isExpress);
    const improve =
      currentScore && currentScore > 0 ? ((bestS - currentScore) / currentScore) * 100 : null;

    return {
      ...base,
      verdict: "recommend_lower",
      why: `Alive SKU, above CH market (+${gapPct.toFixed(1)}%). Buy ${input.buyCostChf} CHF → floor ${floor} CHF. Best performance×pocket at ${bestP} CHF (not raw benchmark ${input.benchmarkPrice} CHF)${
        base.canReachBenchmark ? "" : "; cannot reach benchmark without breaking margin"
      }.`,
      bestPriceChf: bestP,
      deltaVsCurrentChf: Math.round((bestP - current) * 100) / 100,
      bestPocketChf: bestPocket,
      bestPerformanceScore: bestS,
      scoreImprovementPct: improve == null ? null : Math.round(improve * 10) / 10,
    };
  }

  // --- Below market: raise toward market if demand exists and pocket improves ---
  if (gapPct <= -threshold) {
    const hi = Math.max(current, Math.min(input.benchmarkPrice, current * 1.35));
    if (hi <= current + 0.5) {
      return {
        ...base,
        verdict: "hold",
        why: `Below market (${gapPct.toFixed(1)}%) but no raise room under cap.`,
      };
    }
    const lo = Math.max(current, floor);
    const grid = buildPriceGrid(lo, hi);
    let bestP = current;
    let bestS = currentScore ?? -Infinity;
    for (const p of grid) {
      if (p < current - 0.01) continue;
      const pocket = estimateNetPocketChf(p, input.buyCostChf, isExpress);
      if (pocket == null || pocket <= 0) continue;
      const s = scoreAt(p);
      if (s == null) continue;
      if (s > bestS + 1e-9) {
        bestS = s;
        bestP = p;
      }
    }

    if (bestP <= current + 0.5) {
      return {
        ...base,
        verdict: "hold",
        why: `Below market (${gapPct.toFixed(1)}%) but raising does not improve pocket×demand score (demand penalty).`,
        bestPriceChf: current,
        deltaVsCurrentChf: 0,
        bestPocketChf: base.currentPocketChf,
        bestPerformanceScore: currentScore,
        scoreImprovementPct: 0,
      };
    }

    const bestPocket = estimateNetPocketChf(bestP, input.buyCostChf, isExpress);
    const improve =
      currentScore && currentScore > 0 ? ((bestS - currentScore) / currentScore) * 100 : null;

    return {
      ...base,
      verdict: "recommend_raise",
      why: `Alive SKU, below CH market (${gapPct.toFixed(1)}%). Leaving money on table. Best pocket×demand at ${bestP} CHF (benchmark ${input.benchmarkPrice}).`,
      bestPriceChf: bestP,
      deltaVsCurrentChf: Math.round((bestP - current) * 100) / 100,
      bestPocketChf: bestPocket,
      bestPerformanceScore: bestS,
      scoreImprovementPct: improve == null ? null : Math.round(improve * 10) / 10,
    };
  }

  return {
    ...base,
    verdict: "hold",
    why: `Within ±${threshold}% of CH benchmark (${gapPct.toFixed(1)}%). No meaningful move.`,
    bestPriceChf: current,
    deltaVsCurrentChf: 0,
    bestPocketChf: base.currentPocketChf,
    bestPerformanceScore: currentScore,
    scoreImprovementPct: 0,
  };
}
