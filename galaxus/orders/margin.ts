/**
 * Galaxus B2B: treat `lineNetAmount` (or price line total) as final revenue — no marketplace
 * commission slice like Decathlon’s 16% Mirakl fee. Profit vs StockX is simply revenue − cost.
 */

export type GalaxusLineProfitBreakdown = {
  revenueChf: number;
  stockxCostChf: number;
  profitChf: number;
  profitPercentOfRevenue: number | null;
};

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Net line total from Galaxus (CHF) — same field used in warehouse manual-entry margin preview. */
export function galaxusLineNetRevenueChf(line: {
  lineNetAmount?: unknown;
  priceLineAmount?: unknown;
}): number | null {
  const fromLine = toFiniteNumber(line?.lineNetAmount);
  if (fromLine != null && fromLine > 0) return fromLine;
  const fromPriceLine = toFiniteNumber(line?.priceLineAmount);
  if (fromPriceLine != null && fromPriceLine > 0) return fromPriceLine;
  return null;
}

export function galaxusProfitFromRevenueAndStockxCost(
  revenueChf: number,
  stockxCostChf: number
): GalaxusLineProfitBreakdown | null {
  if (!Number.isFinite(revenueChf) || !Number.isFinite(stockxCostChf)) return null;
  const profitChf = revenueChf - stockxCostChf;
  return {
    revenueChf,
    stockxCostChf,
    profitChf,
    profitPercentOfRevenue: revenueChf > 0 ? (profitChf / revenueChf) * 100 : null,
  };
}
