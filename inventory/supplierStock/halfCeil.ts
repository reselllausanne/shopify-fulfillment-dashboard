/**
 * Shared halfCeil publish rule: 0→0, 1→1, 2→1, 3→2, 10→5.
 * All suppliers should apply this to the page-proven source qty.
 */
export function halfCeil(n: number | null | undefined): number {
  const qty = Math.max(0, Math.floor(Number(n) || 0));
  if (qty <= 0) return 0;
  return Math.ceil(qty / 2);
}

export function halfCeilCapped(n: number | null | undefined, maxPublished = 12): number {
  const v = halfCeil(n);
  return Math.min(v, Math.max(0, maxPublished));
}
