/**
 * Filter Galaxus orders that still need StockX matching / linking.
 * Fully fulfilled (all lines shipped) orders are never match candidates.
 */

export type GalaxusOrderOpenness = {
  /** True when at least one line still has remaining shippable qty. */
  isOpenOrPartial: boolean;
  openLineCount: number;
  totalLines: number;
};

export function assessGalaxusOrderOpenness(params: {
  cancelledAt?: Date | string | null;
  archivedAt?: Date | string | null;
  lines: Array<{
    quantity?: number | null;
    warehouseMarkedShippedAt?: Date | string | null;
    remaining?: number | null;
  }>;
  /** Optional: remaining qty already computed per line id. */
  remainingByLineId?: Map<string, number> | Record<string, number>;
}): GalaxusOrderOpenness {
  if (params.cancelledAt || params.archivedAt) {
    return { isOpenOrPartial: false, openLineCount: 0, totalLines: 0 };
  }

  const lines = params.lines ?? [];
  let openLineCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as any;
    const lineId = String(line?.id ?? i);
    let remaining: number | null = null;

    if (params.remainingByLineId) {
      if (params.remainingByLineId instanceof Map) {
        remaining =
          params.remainingByLineId.has(lineId)
            ? Number(params.remainingByLineId.get(lineId))
            : null;
      } else if (lineId in params.remainingByLineId) {
        remaining = Number((params.remainingByLineId as Record<string, number>)[lineId]);
      }
    }

    if (remaining == null && typeof line.remaining === "number") {
      remaining = line.remaining;
    }

    if (remaining == null) {
      const qty = Math.max(0, Math.round(Number(line.quantity ?? 0)));
      // Without shipment coverage, treat warehouseMarkedShippedAt as fully shipped.
      if (line.warehouseMarkedShippedAt) {
        remaining = 0;
      } else {
        remaining = qty;
      }
    }

    if (remaining > 0) openLineCount += 1;
  }

  return {
    isOpenOrPartial: openLineCount > 0,
    openLineCount,
    totalLines: lines.length,
  };
}

/** True when order should be excluded from StockX↔Galaxus matching. */
export function shouldSkipGalaxusOrderForMatching(params: {
  cancelledAt?: Date | string | null;
  archivedAt?: Date | string | null;
  lines: Array<{
    id?: string;
    quantity?: number | null;
    warehouseMarkedShippedAt?: Date | string | null;
    remaining?: number | null;
  }>;
  /** When all STX slots already linked and no refresh needed. */
  needsStockxLink?: boolean;
  remainingByLineId?: Map<string, number> | Record<string, number>;
}): boolean {
  if (params.cancelledAt || params.archivedAt) return true;
  if (params.needsStockxLink === false) {
    const openness = assessGalaxusOrderOpenness(params);
    // Still allow refresh on open orders; skip only when fully closed.
    if (!openness.isOpenOrPartial) return true;
  }
  const openness = assessGalaxusOrderOpenness(params);
  return !openness.isOpenOrPartial;
}
