import { sanitizePublishedQuantity } from "@/galaxus/exports/feedIntegrityRules";

/** Minimum StockX ask count before STX variant is listed (import + Galaxus/Decathlon stock feeds). */
export const STX_MIN_ASKS_FOR_LISTING = 1;

export function isStxListingEligibleAsks(asks: number): boolean {
  return Number.isFinite(asks) && asks >= STX_MIN_ASKS_FOR_LISTING;
}

/** Map StockX ask depth → published marketplace quantity (conservative caps). */
export function publishStxStockFromAsks(asks: number): number {
  if (!isStxListingEligibleAsks(asks)) return 0;
  let published: number;
  if (asks === 1) published = 1;
  else if (asks <= 5) published = 2;
  else if (asks <= 10) published = 5;
  else if (asks <= 20) published = 8;
  else published = 12;

  // Hard integrity: internal 1 never becomes 100 (or any inflated pack qty).
  return sanitizePublishedQuantity({
    internalQty: asks,
    publishedQty: published,
    maxPublished: 12,
  }).qty;
}
