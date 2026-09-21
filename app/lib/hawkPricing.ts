/** HAWK.ch → Galaxus sell: buy CHF + flat CHF 9 fee + 30% margin (cheap floor +5). */
import { applyCheapItemSellFloor } from "@/app/lib/scraperCheapFloor";

export type HawkLandedCost = {
  buyChf: number;
  shippingChf: number;
  shippingReason: string;
  landedChf: number;
  marginPercent: number;
  sellPriceChf: number;
  priceSource: "chf_gross";
  usedMinAbsFloor?: boolean;
};

const FLAT_FEE_CHF = 9;
const MARGIN_PERCENT = 30;

function roundChf(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Landed = buy + CHF 9; sell = landed × 1.30 (or landed+5 if buy &lt; 10). */
export function computeHawkLandedCost(buyChf: number): HawkLandedCost | null {
  if (!Number.isFinite(buyChf) || buyChf <= 0) return null;
  const buy = roundChf(buyChf);
  const shippingChf = FLAT_FEE_CHF;
  const landedChf = roundChf(buy + shippingChf);
  const fromPct = roundChf(landedChf * (1 + MARGIN_PERCENT / 100));
  const floor = applyCheapItemSellFloor({
    buyChf: buy,
    landedChf,
    sellFromPercentChf: fromPct,
  });
  return {
    buyChf: buy,
    shippingChf,
    shippingReason: "flat_fee_chf9",
    landedChf,
    marginPercent: MARGIN_PERCENT,
    sellPriceChf: floor.sellPriceChf,
    priceSource: "chf_gross",
    usedMinAbsFloor: floor.usedMinAbsFloor,
  };
}

export function isPlausibleHawkSellPrice(cost: HawkLandedCost): boolean {
  return Number.isFinite(cost.sellPriceChf) && cost.sellPriceChf > 0 && cost.sellPriceChf < 100_000;
}
