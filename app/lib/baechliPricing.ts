/** Bächli → Galaxus sell: buy CHF + account Mindermenge + 20% margin. Hardcoded. */
export type BaechliLandedCost = {
  buyChf: number;
  shippingChf: number;
  shippingReason: string;
  freeShipMinChf: number;
  landedChf: number;
  marginPercent: number;
  sellPriceChf: number;
  priceSource: "chf_gross";
};

/** Account FAQ: Mindermenge CHF 7.50 under CHF 75; free at/above. */
const FREE_SHIP_MIN_CHF = 75;
const SMALL_ORDER_FEE_CHF = 7.5;
const MARGIN_PERCENT = 20;

function roundChf(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Landed = buy + Mindermenge (if under 75); sell = landed × 1.20. */
export function computeBaechliLandedCost(buyChf: number): BaechliLandedCost | null {
  if (!Number.isFinite(buyChf) || buyChf <= 0) return null;
  const buy = roundChf(buyChf);
  const under = buy < FREE_SHIP_MIN_CHF;
  const shippingChf = under ? SMALL_ORDER_FEE_CHF : 0;
  const landedChf = roundChf(buy + shippingChf);
  const sellPriceChf = roundChf(landedChf * (1 + MARGIN_PERCENT / 100));
  return {
    buyChf: buy,
    shippingChf,
    shippingReason: under ? "mindermengenzuschlag" : "portofrei",
    freeShipMinChf: FREE_SHIP_MIN_CHF,
    landedChf,
    marginPercent: MARGIN_PERCENT,
    sellPriceChf,
    priceSource: "chf_gross",
  };
}

export function isPlausibleBaechliSellPrice(cost: BaechliLandedCost): boolean {
  return Number.isFinite(cost.sellPriceChf) && cost.sellPriceChf > 0 && cost.sellPriceChf < 100_000;
}
