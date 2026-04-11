export const DECATHLON_COMMISSION_RATE = 0.17;
export const DECATHLON_VAT_RATE = 0.08;
export const DECATHLON_FIXED_COST_CHF = 13;
export const DECATHLON_PRICE_ROUND_TO = 0.01;

export type DecathlonSalePriceInputs = {
  buyPrice: number;
  fixedCost?: number;
  commissionRate?: number;
  vatRate?: number;
  targetNetMargin: number;
};

export type DecathlonSalePriceOverrides = {
  fixedCost?: number;
  commissionRate?: number;
  vatRate?: number;
  targetNetMargin?: number;
};

/**
 * Tiered target margin based on buy price.
 * Buy prices below 80 CHF use the same tier as 80-100 CHF.
 */
export function computeDecathlonTargetMargin(buyPrice: number): number | null {
  if (!Number.isFinite(buyPrice) || buyPrice <= 0) return null;
  if (buyPrice < 100) return 0.2;
  if (buyPrice < 120) return 0.18;
  if (buyPrice < 150) return 0.17;
  if (buyPrice < 200) return 0.16;
  if (buyPrice < 300) return 0.15;
  if (buyPrice < 500) return 0.14;
  if (buyPrice < 700) return 0.13;
  if (buyPrice < 1000) return 0.12;
  return 0.1;
}

export function computeDecathlonRetainedRate({
  commissionRate = DECATHLON_COMMISSION_RATE,
  vatRate = DECATHLON_VAT_RATE,
}: {
  commissionRate?: number;
  vatRate?: number;
}): number {
  if (!Number.isFinite(commissionRate) || !Number.isFinite(vatRate)) return 0;
  return 1 - commissionRate - vatRate / (1 + vatRate);
}

export function computeDecathlonSalePriceTTC({
  buyPrice,
  fixedCost = DECATHLON_FIXED_COST_CHF,
  commissionRate = DECATHLON_COMMISSION_RATE,
  vatRate = DECATHLON_VAT_RATE,
  targetNetMargin,
}: DecathlonSalePriceInputs): number | null {
  if (!Number.isFinite(buyPrice) || buyPrice <= 0) return null;
  if (!Number.isFinite(targetNetMargin)) return null;
  const retainedRate = computeDecathlonRetainedRate({ commissionRate, vatRate });
  const denominator = retainedRate - targetNetMargin;
  if (!Number.isFinite(denominator) || denominator <= 0) return null;
  const raw = (buyPrice + fixedCost) / denominator;
  return Number.isFinite(raw) ? raw : null;
}

/**
 * Prix catalogue offre = TTC price from target net margin (tiered).
 */
export function computeDecathlonOfferListPriceFromBuyNow(
  buyNow: number,
  overrides?: DecathlonSalePriceOverrides
): number | null {
  if (!Number.isFinite(buyNow) || buyNow <= 0) return null;
  const targetNetMargin =
    overrides?.targetNetMargin ?? computeDecathlonTargetMargin(buyNow);
  if (targetNetMargin == null) return null;
  const raw = computeDecathlonSalePriceTTC({
    buyPrice: buyNow,
    fixedCost: overrides?.fixedCost ?? DECATHLON_FIXED_COST_CHF,
    commissionRate: overrides?.commissionRate ?? DECATHLON_COMMISSION_RATE,
    vatRate: overrides?.vatRate ?? DECATHLON_VAT_RATE,
    targetNetMargin,
  });
  if (raw == null || raw <= 0) return null;
  return roundToIncrement(raw, DECATHLON_PRICE_ROUND_TO);
}

/**
 * Raw list price without overrides (legacy signature).
 * Prefer `computeDecathlonOfferListPriceFromBuyNow` for exports.
 */
export function computeDecathlonPriceFromBuyNow(
  buyNow: number,
  overrides?: DecathlonSalePriceOverrides
): number | null {
  return computeDecathlonOfferListPriceFromBuyNow(buyNow, overrides);
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
