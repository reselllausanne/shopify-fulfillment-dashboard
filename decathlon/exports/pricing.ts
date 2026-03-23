export const DECATHLON_BUY_NOW_MULTIPLIER = 1.54;
export const DECATHLON_PRICE_ROUND_TO = 0.01;

export function computeDecathlonPriceFromBuyNow(buyNow: number): number | null {
  if (!Number.isFinite(buyNow) || buyNow <= 0) return null;
  const raw = buyNow * DECATHLON_BUY_NOW_MULTIPLIER;
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return roundToIncrement(raw, DECATHLON_PRICE_ROUND_TO);
}

export function resolveDecathlonBuyNow(input: {
  buyNowStockx: number | null;
  manualOverride: number | null;
  manualLock: boolean;
}): number | null {
  if (input.manualLock && input.manualOverride && input.manualOverride > 0) {
    return input.manualOverride;
  }
  if (input.buyNowStockx && input.buyNowStockx > 0) {
    return input.buyNowStockx;
  }
  return null;
}

function roundToIncrement(value: number, increment: number): number {
  if (!Number.isFinite(value)) return value;
  if (!Number.isFinite(increment) || increment <= 0) return value;
  const scale = 1 / increment;
  return Math.round(value * scale) / scale;
}
