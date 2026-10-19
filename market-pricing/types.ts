/**
 * Market price comparator — shared types.
 *
 * Goal: for a product we sell (by GTIN), gather the most CHF price data from the
 * most Swiss sources possible, add a demand signal, and produce a pricing verdict
 * against our StockX floor. Read-only: the engine never writes channel prices.
 */

export type SalesCategory = "sneakers" | "lego" | "electronics" | "apparel" | "other";

export type OfferAvailability = "in_stock" | "out_of_stock" | "unknown";

/** One shop offer for a product, normalized to CHF incl. VAT (consumer price). */
export type MarketOffer = {
  /** Source adapter key: "ponito", "google_shopping", "toppreise", "galaxus_live", ... */
  source: string;
  /** Shop / seller name when known (e.g. "Galaxus", "Ochsner Sport", "Amazon"). */
  seller: string | null;
  /** Consumer price incl. Swiss VAT, CHF. Null when the source gave no price. */
  priceChf: number | null;
  /** Price incl. cheapest shipping when the source exposes it, else null. */
  totalChf: number | null;
  availability: OfferAvailability;
  productUrl: string | null;
  /** True when this offer is our own listing (so we can exclude ourselves). */
  isSelf: boolean;
  observedAt: string;
};

/** Everything one source returned for one GTIN. */
export type SourceResult = {
  source: string;
  /** False when the source is disabled (no API key) or hard-failed. */
  ok: boolean;
  offers: MarketOffer[];
  /** Number of shops the source says carry the product (may exceed offers.length). */
  shopCount: number | null;
  error?: string;
};

/** Demand signal for a product line / query term. */
export type DemandSignal = {
  /** Google Trends interest for the search term, 0–100 relative to its own window. */
  trendsIndex: number | null;
  /** 7d vs prior 7d direction of trends interest. */
  trendsDirection: "rising" | "flat" | "falling" | null;
  /** Units we sold in the lookback window (our own velocity), when provided. */
  ourUnits30d: number | null;
  /** 0–100 blended demand score (trends + our velocity). */
  demandScore: number | null;
};

export type PricingVerdictCode =
  | "HOLD" // priced right vs market
  | "CUT_TO_MARKET" // room to drop toward market and still above floor
  | "RAISE" // we are far cheapest, leave money on table
  | "BELOW_FLOOR_RISK" // market is under our StockX floor — cannot compete profitably
  | "NO_MARKET_DATA"; // not enough offers to judge

export type PricingVerdict = {
  code: PricingVerdictCode;
  /** Our current pushed consumer price incl. VAT (CHF), when known. */
  ourPriceChf: number | null;
  /** Absolute floor consumer price incl. VAT we must never go below (StockX lane). */
  floorPriceChf: number | null;
  /** Consensus market consumer price incl. VAT (median of in-stock rival offers). */
  marketConsensusChf: number | null;
  /** Suggested new consumer price incl. VAT (CHF). Null when HOLD / no data. */
  suggestedPriceChf: number | null;
  /** Cash margin fraction at the suggested price (after VAT gift + box). */
  suggestedCashMargin: number | null;
  rationale: string;
};

/** Full comparator output for one product. */
export type MarketSnapshot = {
  gtin: string;
  providerKey: string | null;
  title: string | null;
  category: SalesCategory;
  /** Supplier cost ex VAT (CHF) used for floor math, when known. */
  supplierCostExVatChf: number | null;
  // Aggregated market view ------------------------------------------------
  rivalOfferCount: number;
  rivalShopCount: number | null;
  minChf: number | null;
  medianChf: number | null;
  maxChf: number | null;
  soldOutRatio: number | null; // 0–1 of rival offers out of stock
  cheapestSeller: string | null;
  sourcesOk: string[];
  sourcesFailed: string[];
  // Signals ---------------------------------------------------------------
  demand: DemandSignal;
  verdict: PricingVerdict;
  offers: MarketOffer[];
  observedAt: string;
};
