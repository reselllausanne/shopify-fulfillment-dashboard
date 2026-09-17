/**
 * Dropship causality: StockX buy must be created AFTER (or within skew of)
 * the customer order. A StockX purchase must never link to a customer order
 * created after that purchase.
 */

export const STOCKX_CAUSAL_SKEW_MINUTES = 5;

export function parseDateMs(value: unknown): number | null {
  if (value == null || value === "") return null;
  const time =
    value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
  return Number.isNaN(time) ? null : time;
}

/**
 * @returns true when supplier/buy time is on or after customer order time
 *          (minus skewMinutes for clock drift).
 */
export function isValidStockxBuyAfterCustomerOrder(
  customerOrderDate: unknown,
  stockxPurchaseDate: unknown,
  skewMinutes: number = STOCKX_CAUSAL_SKEW_MINUTES
): boolean {
  const customerMs = parseDateMs(customerOrderDate);
  const buyMs = parseDateMs(stockxPurchaseDate);
  if (customerMs == null || buyMs == null) return false;
  const toleranceMs = Math.max(0, skewMinutes) * 60 * 1000;
  return buyMs >= customerMs - toleranceMs;
}

/** Alias used by Galaxus auto-link / match routes. */
export function isValidGalaxusStockxCausalBuy(
  orderDate: unknown,
  purchaseDate: unknown,
  skewMinutes: number = STOCKX_CAUSAL_SKEW_MINUTES
): boolean {
  return isValidStockxBuyAfterCustomerOrder(orderDate, purchaseDate, skewMinutes);
}

/** Hours buy is after sale (negative = buy before sale). */
export function signedHoursAfterSale(
  orderDate: unknown,
  purchaseDate: unknown
): number | null {
  const orderMs = parseDateMs(orderDate);
  const purchaseMs = parseDateMs(purchaseDate);
  if (orderMs == null || purchaseMs == null) return null;
  return (purchaseMs - orderMs) / (1000 * 60 * 60);
}

export function computeCausalTimeDiffHours(
  orderDate: unknown,
  purchaseDate: unknown
): number | null {
  const signed = signedHoursAfterSale(orderDate, purchaseDate);
  return signed == null ? null : Math.abs(signed);
}
