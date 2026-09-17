export type DirectPartialLine = {
  quantity?: number | null;
};

/** Multi-line orders or any line with qty>1 must use Ship qty / pack, not whole-order label. */
export function orderRequiresPartialDirectShip(lines: DirectPartialLine[]): boolean {
  const rows = lines ?? [];
  if (rows.length > 1) return true;
  if (rows.length === 1) {
    return Math.max(1, Math.round(Number(rows[0]?.quantity ?? 1))) > 1;
  }
  return false;
}

export const PARTIAL_DIRECT_SHIP_MESSAGE =
  "Use Ship qty on each line (or pack a parcel first). Whole-order label is disabled when quantity > 1 or multiple products.";
