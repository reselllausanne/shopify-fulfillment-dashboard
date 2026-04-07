export const DECATHLON_BUY_NOW_MULTIPLIER = 1.54;
export const DECATHLON_NER_BUY_NOW_MULTIPLIER = 1.1;
export const DECATHLON_PRICE_ROUND_TO = 0.01;

/** Mirakl commission share of list price (seller net model). */
export const DECATHLON_MARKETPLACE_FEE_RATE = 0.17;
/** VAT share of list price reducing seller net in this model (e.g. CH 8%). */
export const DECATHLON_VAT_RATE = 0.08;

/**
 * Target **Mirakl payout** (after −17% commission and −~8% VAT on order total) = buy × multiplier × this + shipping.
 * 20% margin on your buy (after fees are priced in via gross-up).
 */
export const DECATHLON_TARGET_NET_MARGIN = 1.2;

/** Fixed CHF to recover per unit in target net (e.g. outbound ship). */
export const DECATHLON_SHIPPING_COVER_CHF = 13;

/**
 * Portion of list price kept as “real payout” after fee + VAT: 1 − 17% − 8%.
 */
export function decathlonNetRetentionRate(): number {
  return 1 - DECATHLON_MARKETPLACE_FEE_RATE - DECATHLON_VAT_RATE;
}

function isBarePassthroughMultiplier(multiplier: number): boolean {
  return Math.abs(multiplier - 1) < 1e-9;
}

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
 * List price on Decathlon/Mirakl so that **payout** (order total − commission − VAT) matches your target:
 * - `targetNet = buyNow × multiplier × 1.2 + 13 CHF` (20% on buy after fees + ship recovery)
 * - `listPrice = targetNet / (1 − 0.17 − 0.08)` — matches ~178.82 → ~135 CHF net on a typical line.
 *
 * `THE_*` (multiplier 1): no extra 20% on cost, only gross-up for fees + fixed ship: `buyNow + 13`.
 */
export function computeDecathlonOfferListPriceFromBuyNow(
  buyNow: number,
  multiplier: number = DECATHLON_BUY_NOW_MULTIPLIER
): number | null {
  if (!Number.isFinite(buyNow) || buyNow <= 0) return null;
  if (!Number.isFinite(multiplier) || multiplier <= 0) return null;
  const retention = decathlonNetRetentionRate();
  if (!Number.isFinite(retention) || retention <= 0) return null;

  const shipping = Number.isFinite(DECATHLON_SHIPPING_COVER_CHF) ? DECATHLON_SHIPPING_COVER_CHF : 0;
  const marginMult = isBarePassthroughMultiplier(multiplier) ? 1 : DECATHLON_TARGET_NET_MARGIN;
  const targetNet = buyNow * multiplier * marginMult + shipping;
  const raw = targetNet / retention;
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
