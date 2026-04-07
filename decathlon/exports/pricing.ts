export const DECATHLON_BUY_NOW_MULTIPLIER = 1.54;
export const DECATHLON_NER_BUY_NOW_MULTIPLIER = 1.1;
export const DECATHLON_PRICE_ROUND_TO = 0.01;

/**
 * Liste Decathlon = `buyNow × (1 + this) + DECATHLON_SHIPPING_COVER_CHF` (ex. 115 → 115×1.5+13 ≈ 185.50).
 */
export const DECATHLON_BUY_MARKUP_FRACTION = 0.5;

/** Fixed CHF added on top (fulfilment). */
export const DECATHLON_SHIPPING_COVER_CHF = 13;

/**
 * Sell price = supplier `price` × multiplier. `THE_*` is treated as your own inventory: multiplier 1 (no margin).
 * `NER_*` uses the lighter NER multiplier; everything else (e.g. STX) uses the default buy-now margin.
 */
export function decathlonSellPriceMultiplierForCandidate(candidate: {
  providerKey?: string;
  supplierVariantId?: string | null;
}): number {
  const pk = String(candidate.providerKey ?? "").trim();
  const sv = String(candidate.supplierVariantId ?? "").trim();
  const pkU = pk.toUpperCase();
  const svL = sv.toLowerCase();
  if (pkU.startsWith("THE_") || svL.startsWith("the_") || svL.startsWith("the:")) {
    return 1;
  }
  if (pkU.startsWith("NER_") || svL.startsWith("ner_")) {
    return DECATHLON_NER_BUY_NOW_MULTIPLIER;
  }
  return DECATHLON_BUY_NOW_MULTIPLIER;
}

/**
 * Prix catalogue offre = `buyNow × (1 + DECATHLON_BUY_MARKUP_FRACTION) + DECATHLON_SHIPPING_COVER_CHF`.
 * Le multiplicateur STX/NER/THE n’entre plus en ligne (uniquement le buy now).
 */
export function computeDecathlonOfferListPriceFromBuyNow(
  buyNow: number,
  _multiplier?: number
): number | null {
  if (!Number.isFinite(buyNow) || buyNow <= 0) return null;
  const shipping = Number.isFinite(DECATHLON_SHIPPING_COVER_CHF) ? DECATHLON_SHIPPING_COVER_CHF : 0;
  const factor = 1 + DECATHLON_BUY_MARKUP_FRACTION;
  if (!Number.isFinite(factor) || factor <= 0) return null;
  const raw = buyNow * factor + shipping;
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return roundToIncrement(raw, DECATHLON_PRICE_ROUND_TO);
}

/** Raw list price without fee gross-up (legacy: buy × multiplier only). Prefer `computeDecathlonOfferListPriceFromBuyNow` for exports. */
export function computeDecathlonPriceFromBuyNow(
  buyNow: number,
  multiplier: number = DECATHLON_BUY_NOW_MULTIPLIER
): number | null {
  if (!Number.isFinite(buyNow) || buyNow <= 0) return null;
  const raw = buyNow * multiplier;
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
