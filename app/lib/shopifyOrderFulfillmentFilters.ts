/**
 * Shared rules for “match this Shopify sale to supplier” flows:
 * drop cancelled / void / refunded (non-partial) orders and non-fulfillable lines.
 */

export function shouldSkipOrderForFulfillmentMatching(o: {
  cancelledAt?: string | null;
  displayFinancialStatus?: string | null;
}): boolean {
  if (o.cancelledAt) return true;
  const fin = (o.displayFinancialStatus || "").toUpperCase();
  if (fin.includes("VOID")) return true;
  if (fin.startsWith("REFUNDED")) return true;
  return false;
}

export function lineFulfillableQuantity(li: any): number {
  const fulfillable = Number(li?.fulfillableQuantity ?? NaN);
  if (Number.isFinite(fulfillable)) return fulfillable;
  return Number(li?.quantity ?? 0);
}
