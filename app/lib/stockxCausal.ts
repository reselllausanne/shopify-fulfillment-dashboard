/**
 * Dropship causality: StockX buy MUST be created on or after the customer
 * order. No clock-skew allowance — buyMs >= customerMs is the only valid
 * predicate. A StockX purchase must never link to a customer order created
 * after that purchase.
 *
 * Callers that create NEW links must treat a missing purchase date as a hard
 * reject (do not skip the gate when the date is null).
 */

export const STOCKX_CAUSAL_SKEW_MINUTES = 0;

export function parseDateMs(value: unknown): number | null {
  if (value == null || value === "") return null;
  const time =
    value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
  return Number.isNaN(time) ? null : time;
}

/**
 * @returns true iff supplier/buy time is on or after customer order time.
 *          The optional `_skewMinutes` argument is IGNORED (kept only for
 *          call-site compatibility during migration).
 */
export function isValidStockxBuyAfterCustomerOrder(
  customerOrderDate: unknown,
  stockxPurchaseDate: unknown,
  _skewMinutes: number = STOCKX_CAUSAL_SKEW_MINUTES
): boolean {
  const customerMs = parseDateMs(customerOrderDate);
  const buyMs = parseDateMs(stockxPurchaseDate);
  if (customerMs == null || buyMs == null) return false;
  return buyMs >= customerMs;
}

/** Alias used by Galaxus auto-link / match routes. */
export function isValidGalaxusStockxCausalBuy(
  orderDate: unknown,
  purchaseDate: unknown,
  _skewMinutes: number = STOCKX_CAUSAL_SKEW_MINUTES
): boolean {
  return isValidStockxBuyAfterCustomerOrder(orderDate, purchaseDate);
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
