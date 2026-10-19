import {
  FIXED_BOX_SHIP_CHF,
  MARKET_CUT_TRIGGER_CHF,
  MARKET_MIN_RIVAL_OFFERS,
  MARKET_RAISE_TRIGGER_CHF,
  MARKET_UNDERCUT_CHF,
  SWISS_SALDO_RATE,
  SWISS_VAT_INCL,
} from "@/market-pricing/config";
import type { PricingVerdict } from "@/market-pricing/types";
import type { AggregatedMarket } from "@/market-pricing/aggregate";

export type VerdictInput = {
  market: AggregatedMarket;
  /** Our current pushed consumer price incl. VAT (CHF), or null. */
  ourPriceInclChf: number | null;
  /** Absolute floor consumer price incl. VAT (StockX lane), or null when no cost. */
  floorInclChf: number | null;
  /** Supplier cost ex VAT (CHF) for cash-margin math, or null. */
  supplierCostExVatChf: number | null;
};

function round05(v: number): number {
  return Math.round(v * 20) / 20;
}

/**
 * Cash margin fraction at a given consumer incl-VAT price:
 *   cash = price*(1 - saldo) - cost - box;  margin = cash / price
 * Mirrors galaxus/exports/pricing.ts economics (VAT gift kept, 2.1% saldo remitted).
 */
export function cashMarginAt(priceInclChf: number, costExVatChf: number | null): number | null {
  if (!Number.isFinite(priceInclChf) || priceInclChf <= 0) return null;
  if (costExVatChf == null || !Number.isFinite(costExVatChf)) return null;
  const cash = priceInclChf * (1 - SWISS_SALDO_RATE) - costExVatChf - FIXED_BOX_SHIP_CHF;
  return cash / priceInclChf;
}

/** Consumer incl-VAT floor from a supplier cost ex VAT, using the STX lane logic. */
export function floorInclFromExVatSell(sellExVatChf: number | null): number | null {
  if (sellExVatChf == null || !Number.isFinite(sellExVatChf) || sellExVatChf <= 0) return null;
  return Math.round(sellExVatChf * (1 + SWISS_VAT_INCL) * 100) / 100;
}

/**
 * Decide what to do with our price given the aggregated market, our price, and
 * the absolute floor. Never suggests a price below the floor.
 */
export function decideVerdict(input: VerdictInput): PricingVerdict {
  const { market, ourPriceInclChf, floorInclChf, supplierCostExVatChf } = input;
  const consensus = market.medianChf;
  const cheapest = market.minChf;

  const base: Omit<PricingVerdict, "code" | "suggestedPriceChf" | "suggestedCashMargin" | "rationale"> =
    {
      ourPriceChf: ourPriceInclChf,
      floorPriceChf: floorInclChf,
      marketConsensusChf: consensus,
    };

  if (market.rivalOfferCount < MARKET_MIN_RIVAL_OFFERS || cheapest == null || consensus == null) {
    return {
      ...base,
      code: "NO_MARKET_DATA",
      suggestedPriceChf: null,
      suggestedCashMargin: null,
      rationale: `Only ${market.rivalOfferCount} rival offer(s); need ≥${MARKET_MIN_RIVAL_OFFERS} to judge.`,
    };
  }

  // Market is cheaper than we can profitably sell → do not chase.
  if (floorInclChf != null && cheapest < floorInclChf) {
    return {
      ...base,
      code: "BELOW_FLOOR_RISK",
      suggestedPriceChf: null,
      suggestedCashMargin: null,
      rationale:
        `Cheapest rival CHF ${cheapest.toFixed(2)} is under our floor CHF ${floorInclChf.toFixed(2)}. ` +
        `Matching would break the StockX margin lane. Hold or delist.`,
    };
  }

  // Target: sit just under the cheapest rival, clamped to the floor.
  const rawTarget = cheapest - MARKET_UNDERCUT_CHF;
  const suggested = round05(floorInclChf != null ? Math.max(floorInclChf, rawTarget) : rawTarget);

  // Too cheap: we are well under the market → raise toward it.
  if (ourPriceInclChf != null && cheapest - ourPriceInclChf >= MARKET_RAISE_TRIGGER_CHF) {
    const raiseTo = round05(Math.max(ourPriceInclChf, cheapest - MARKET_UNDERCUT_CHF));
    return {
      ...base,
      code: "RAISE",
      suggestedPriceChf: raiseTo,
      suggestedCashMargin: cashMarginAt(raiseTo, supplierCostExVatChf),
      rationale:
        `We are CHF ${(cheapest - ourPriceInclChf).toFixed(2)} under the cheapest rival ` +
        `(CHF ${cheapest.toFixed(2)}). Room to lift toward market.`,
    };
  }

  // Overpriced vs market and the cut stays above floor → cut.
  if (
    ourPriceInclChf != null &&
    ourPriceInclChf - consensus >= MARKET_CUT_TRIGGER_CHF &&
    suggested < ourPriceInclChf &&
    (floorInclChf == null || suggested >= floorInclChf)
  ) {
    return {
      ...base,
      code: "CUT_TO_MARKET",
      suggestedPriceChf: suggested,
      suggestedCashMargin: cashMarginAt(suggested, supplierCostExVatChf),
      rationale:
        `We are CHF ${(ourPriceInclChf - consensus).toFixed(2)} above market median ` +
        `(CHF ${consensus.toFixed(2)}). Cut to CHF ${suggested.toFixed(2)}, still ≥ floor.`,
    };
  }

  return {
    ...base,
    code: "HOLD",
    suggestedPriceChf: null,
    suggestedCashMargin:
      ourPriceInclChf != null ? cashMarginAt(ourPriceInclChf, supplierCostExVatChf) : null,
    rationale: "Priced in line with the market. No change.",
  };
}
