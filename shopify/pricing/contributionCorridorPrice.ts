import { ceilToWholeFranc } from "@/shopify/pricing/calcShopifySellPrice";

/**
 * Repricing corridor — not the live Shopify lock.
 *
 * Ads are not a flat CPA pasted onto every offer. A comparable sneaker shop
 * spends 10–15% of revenue on paid ads. This account's working month (August)
 * was 14.5%. The anchor is 14% at a 220 CHF order:
 *   8% of that pair's own sell price + 13 CHF per order.
 * At 220 CHF that is 14%. At 400 CHF it is about 11%.
 *
 * StockX buy, ship 14.50, payment 2.75% and VAT 2.3% stay fixed.
 * Remaining margin is held between 8% and 10% of the sell price.
 * The Merchant benchmark may move the ticket only inside that band.
 */
export const CONTRIBUTION_CORRIDOR_VERSION = "2026-09-28-hybrid-14";
export const CONTRIBUTION_REFERENCE_AOV_CHF = 220;
export const CONTRIBUTION_ADS_VARIABLE_RATE = 0.08;
export const CONTRIBUTION_ADS_FIXED_CHF = 13;
export const CONTRIBUTION_SHIP_CHF = 14.5;
export const CONTRIBUTION_PAYMENT_RATE = 0.0275;
export const CONTRIBUTION_VAT_RATE = 0.023;
export const CONTRIBUTION_CM_MIN = 0.08;
export const CONTRIBUTION_CM_TARGET = 0.09;
export const CONTRIBUTION_CM_MAX = 0.1;
export const CONTRIBUTION_STOCKX_RATE = 1.08;
export const CONTRIBUTION_STOCKX_INBOUND_CHF = 20;

export type ContributionPriceDecision = "target" | "match_benchmark" | "margin_floor" | "margin_cap";

export type ContributionCorridorQuote = {
  sourceCostChf: number;
  floorChf: number;
  targetChf: number;
  capChf: number;
  sellChf: number;
  decision: ContributionPriceDecision;
  remainingMarginRate: number;
  adsShareOfRevenue: number;
};

function denom(marginRate: number): number {
  return (
    1 -
    CONTRIBUTION_PAYMENT_RATE -
    CONTRIBUTION_VAT_RATE -
    CONTRIBUTION_ADS_VARIABLE_RATE -
    marginRate
  );
}

/** Ads francs at a known sell price: 8% of that price plus 13 CHF. */
export function adsChfAtSellPrice(sellChf: number): number | null {
  const sell = Number(sellChf);
  if (!Number.isFinite(sell) || sell <= 0) return null;
  return sell * CONTRIBUTION_ADS_VARIABLE_RATE + CONTRIBUTION_ADS_FIXED_CHF;
}

export function adsShareAtSellPrice(sellChf: number): number | null {
  const ads = adsChfAtSellPrice(sellChf);
  const sell = Number(sellChf);
  if (ads == null || !(sell > 0)) return null;
  return ads / sell;
}

/** Whole-franc price that leaves `marginRate` after ship, payment, VAT and hybrid ads. */
export function contributionPriceForMargin(sourceCostChf: number, marginRate: number): number | null {
  const cost = Number(sourceCostChf);
  if (!Number.isFinite(cost) || cost <= 0) return null;
  const divisor = denom(marginRate);
  if (!(divisor > 0)) return null;
  return ceilToWholeFranc(
    (cost + CONTRIBUTION_SHIP_CHF + CONTRIBUTION_ADS_FIXED_CHF) / divisor
  );
}

export function sourceCostFromStockxRaw(stockxRaw: number): number | null {
  const raw = Number(stockxRaw);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return raw * CONTRIBUTION_STOCKX_RATE + CONTRIBUTION_STOCKX_INBOUND_CHF;
}

/** Margin left after payment, VAT, ship and the hybrid ad cost, as a share of sell price. */
export function remainingMarginRate(sellChf: number, sourceCostChf: number): number | null {
  const sell = Number(sellChf);
  const cost = Number(sourceCostChf);
  const ads = adsChfAtSellPrice(sell);
  if (!Number.isFinite(sell) || sell <= 0 || !Number.isFinite(cost) || cost <= 0 || ads == null) {
    return null;
  }
  const kept =
    sell * (1 - CONTRIBUTION_PAYMENT_RATE - CONTRIBUTION_VAT_RATE) -
    cost -
    CONTRIBUTION_SHIP_CHF -
    ads;
  return kept / sell;
}

/**
 * One pair. `sourceCostChf` is the fixed StockX buy when known.
 * Otherwise `stockxRaw` is the ask and the buy is ask × 1.08 + 20.
 */
export function quoteContributionCorridor(input: {
  stockxRaw?: number;
  sourceCostChf?: number;
  benchmarkChf?: number | null;
}): ContributionCorridorQuote | null {
  const sourceCost =
    input.sourceCostChf != null
      ? Number(input.sourceCostChf)
      : sourceCostFromStockxRaw(Number(input.stockxRaw));
  if (sourceCost == null || !Number.isFinite(sourceCost) || sourceCost <= 0) return null;

  const floor = contributionPriceForMargin(sourceCost, CONTRIBUTION_CM_MIN);
  const target = contributionPriceForMargin(sourceCost, CONTRIBUTION_CM_TARGET);
  const cap = contributionPriceForMargin(sourceCost, CONTRIBUTION_CM_MAX);
  if (floor == null || target == null || cap == null) return null;

  const benchmark = Number(input.benchmarkChf);
  let sell = target;
  let decision: ContributionPriceDecision = "target";
  if (Number.isFinite(benchmark) && benchmark > 0) {
    if (benchmark < floor) {
      sell = floor;
      decision = "margin_floor";
    } else if (benchmark > cap) {
      sell = cap;
      decision = "margin_cap";
    } else {
      sell = ceilToWholeFranc(benchmark);
      decision = "match_benchmark";
    }
  }

  const margin = remainingMarginRate(sell, sourceCost);
  const adsShare = adsShareAtSellPrice(sell);
  return {
    sourceCostChf: Math.round(sourceCost * 100) / 100,
    floorChf: floor,
    targetChf: target,
    capChf: cap,
    sellChf: sell,
    decision,
    remainingMarginRate: margin == null ? NaN : Math.round(margin * 10000) / 10000,
    adsShareOfRevenue: adsShare == null ? NaN : Math.round(adsShare * 10000) / 10000,
  };
}
