/**
 * Warehouse pack builder only needs lines that can still go in a box.
 * Every Galaxus warehouse order shares one delivery address, so the eligible
 * query matches the full history. Drop closed lines before catalog enrichment.
 */

export type OpenLineCoverage = {
  remaining?: number | null;
};

export function lineIsOpenForPack(
  lineId: string,
  shipmentCoverage: Record<string, OpenLineCoverage | undefined>
): boolean {
  const raw = shipmentCoverage[String(lineId)]?.remaining;
  if (raw == null) return true;
  const remaining = Number(raw);
  if (!Number.isFinite(remaining)) return true;
  return remaining > 0;
}

export function filterOrdersToOpenLines<T extends { lines?: Array<{ id: string }> | null }>(
  orders: T[],
  shipmentCoverage: Record<string, OpenLineCoverage | undefined>
): T[] {
  const out: T[] = [];
  for (const order of orders) {
    const lines = (order.lines ?? []).filter((line) =>
      lineIsOpenForPack(String(line.id), shipmentCoverage)
    );
    if (lines.length === 0) continue;
    out.push({ ...order, lines });
  }
  return out;
}
