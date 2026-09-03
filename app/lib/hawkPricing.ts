/** HAWK.ch → Galaxus sell: buy CHF + flat CHF 9 fee + 20% margin. Hardcoded, no env knobs. */
export type HawkLandedCost = {
  buyChf: number;
  shippingChf: number;
  shippingReason: string;
  landedChf: number;
  marginPercent: number;
  sellPriceChf: number;
  priceSource: "chf_gross";
};

const FLAT_FEE_CHF = 9;
const MARGIN_PERCENT = 20;

function roundChf(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Landed = buy + CHF 9; sell = landed × 1.20. */
export function computeHawkLandedCost(buyChf: number): HawkLandedCost | null {
  if (!Number.isFinite(buyChf) || buyChf <= 0) return null;
  const buy = roundChf(buyChf);
  const shippingChf = FLAT_FEE_CHF;
  const landedChf = roundChf(buy + shippingChf);
  const sellPriceChf = roundChf(landedChf * (1 + MARGIN_PERCENT / 100));
  return {
    buyChf: buy,
    shippingChf,
    shippingReason: "flat_fee_chf9",
    landedChf,
    marginPercent: MARGIN_PERCENT,
    sellPriceChf,
    priceSource: "chf_gross",
  };
}

export function isPlausibleHawkSellPrice(cost: HawkLandedCost): boolean {
  return Number.isFinite(cost.sellPriceChf) && cost.sellPriceChf > 0 && cost.sellPriceChf < 100_000;
}
