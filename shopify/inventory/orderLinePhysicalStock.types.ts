export type OrderLinePhysicalStock = {
  qty: number;
  locationName: string;
  locationId: string | null;
  /**
   * True when qty may already be 0 on the mirror (marketplace sale decremented
   * Shopify) but this order line is reserved / sold from that location.
   */
  reservedFromSale?: boolean;
};

export function formatPhysicalStockLabel(
  stock: OrderLinePhysicalStock | null | undefined
): string | null {
  if (!stock) return null;
  const loc = String(stock.locationName ?? "").trim() || "Physical stock";
  if (stock.reservedFromSale) {
    return `Warehouse · ${loc}`;
  }
  if (stock.qty <= 0) return null;
  return `In stock · ${loc} (${stock.qty})`;
}
