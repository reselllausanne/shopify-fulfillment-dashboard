/** Minimum StockX ask count before STX variant is listed (import + Galaxus/Decathlon stock feeds). */
export const STX_MIN_ASKS_FOR_LISTING = 1;

export function isStxListingEligibleAsks(asks: number): boolean {
  return Number.isFinite(asks) && asks >= STX_MIN_ASKS_FOR_LISTING;
}

/** Map StockX ask depth → published marketplace quantity (conservative caps). */
export function publishStxStockFromAsks(asks: number): number {
  if (!isStxListingEligibleAsks(asks)) return 0;
  if (asks === 1) return 1;
  if (asks <= 5) return 2;
  if (asks <= 10) return 5;
  if (asks <= 20) return 8;
  return 12;
}
