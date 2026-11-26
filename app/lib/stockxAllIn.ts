/**
 * What a StockX pair really costs us in CHF (checkout total) from the list ask.
 *
 * Measured on real purchases (OrderMatch.supplierCost, 2026-11): cost = ask * 1.075 + 20.
 * #7831 express ask 123 -> 152.23, #7838 -> 125.35, #7839 -> 182.32, #7828 -> 131.80,
 * #7827 -> 104.92, #7830 -> 178.02, #7840 -> 198.45.
 *
 * This is NOT `estimatedStockxBuyChfFromList` (x1.1065, an older single-checkout calibration
 * that feeds sell prices and Galaxus pricing). Changing that one moves published prices,
 * so margin displays use their own constants.
 */
export const STX_ALL_IN_PROCESSING_SHARE = 0.075;
export const STX_ALL_IN_DEFAULT_SHIPPING_CHF = 20;

/** Legacy multiplier of `estimatedStockxBuyChfFromList`, used only to unwind stored prices. */
const LEGACY_STORED_MULTIPLIER = 1 + 23.11 / 217;

export function stockxAllInChf(askChf: number, shippingChf: number = STX_ALL_IN_DEFAULT_SHIPPING_CHF): number {
  return Math.round((askChf * (1 + STX_ALL_IN_PROCESSING_SHARE) + shippingChf) * 100) / 100;
}

/** Re-express a stored `SupplierVariant` buy price (legacy x1.1065 + shipping) as a real all-in. */
export function restateStoredBuyChf(
  storedChf: number,
  shippingChf: number = STX_ALL_IN_DEFAULT_SHIPPING_CHF
): number {
  const ask = Math.max(0, storedChf - shippingChf) / LEGACY_STORED_MULTIPLIER;
  return stockxAllInChf(ask, shippingChf);
}
