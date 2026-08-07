/**
 * Warehouse / soldes shelf price for Galaxus offer feed.
 *
 * Shopify sell (manualPrice) is the number we advertise — push it as-is.
 * Never divide by VAT. Never re-run STX dropship margin on top.
 */
export function resolveGalaxusInStockOfferPrice(input: {
  hasPhysicalStock: boolean;
  manualLock: boolean;
  manualPrice: number | null | undefined;
}): number | null {
  const shelf = Number(input.manualPrice);
  if (!Number.isFinite(shelf) || shelf <= 0) return null;
  if (input.hasPhysicalStock || input.manualLock) return shelf;
  return null;
}
