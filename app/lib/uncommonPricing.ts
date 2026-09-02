/** The Uncommon Shop CHF retail → Galaxus sell (ship + % margin). */

export type UncommonLandedCost = {
  buyChf: number;
  shippingChf: number;
  shippingReason: string;
  landedChf: number;
  marginPercent: number;
  sellPriceChf: number;
  priceSource: "chf_shelf_plus_ship_plus_margin";
  freeShipThresholdChf: number;
};

/** Free delivery from CHF 79 (storefront claim). Below → flat CH ship. */
export const UNCOMMON_FREE_SHIP_THRESHOLD_CHF = 79;
/** Conservative Post/DPD-ish rate under free-ship threshold. */
export const UNCOMMON_FLAT_SHIPPING_CHF = 7;

export function uncommonPricingConfig() {
  return {
    marginPercent: Math.max(0, Number(process.env.SCRAPER_TUS_MARGIN_PERCENT || "20")),
    shippingChf: Math.max(
      0,
      Number(process.env.SCRAPER_TUS_SHIPPING_CHF || UNCOMMON_FLAT_SHIPPING_CHF)
    ),
    freeShipThresholdChf: Math.max(
      0,
      Number(process.env.SCRAPER_TUS_FREE_SHIP_CHF || UNCOMMON_FREE_SHIP_THRESHOLD_CHF)
    ),
  };
}

function roundChf(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Landed = buy + ship (0 if buy ≥ free threshold); sell = landed × (1 + margin%). */
export function computeUncommonLandedCost(buyChf: number): UncommonLandedCost | null {
  if (!Number.isFinite(buyChf) || buyChf <= 0) return null;
  const cfg = uncommonPricingConfig();
  const buy = roundChf(buyChf);
  const free = buy >= cfg.freeShipThresholdChf;
  const shippingChf = free ? 0 : cfg.shippingChf;
  const landedChf = roundChf(buy + shippingChf);
  const sellPriceChf = roundChf(landedChf * (1 + cfg.marginPercent / 100));
  return {
    buyChf: buy,
    shippingChf,
    shippingReason: free ? "free_ship_threshold" : "flat_under_threshold",
    landedChf,
    marginPercent: cfg.marginPercent,
    sellPriceChf,
    priceSource: "chf_shelf_plus_ship_plus_margin",
    freeShipThresholdChf: cfg.freeShipThresholdChf,
  };
}

export function isPlausibleUncommonSellPrice(cost: UncommonLandedCost): boolean {
  return Number.isFinite(cost.sellPriceChf) && cost.sellPriceChf > 0 && cost.sellPriceChf < 100_000;
}
