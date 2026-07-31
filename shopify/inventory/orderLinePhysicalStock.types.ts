export type OrderLinePhysicalStock = {
  qty: number;
  locationName: string;
  locationId: string | null;
};

export function formatPhysicalStockLabel(
  stock: OrderLinePhysicalStock | null | undefined
): string | null {
  if (!stock || stock.qty <= 0) return null;
  return `In stock · ${stock.locationName} (${stock.qty})`;
}
