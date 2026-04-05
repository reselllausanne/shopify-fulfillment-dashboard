/**
 * Decathlon keeps 16% of Mirakl line sell. For margin vs buy cost, use sell × (1 − rate) per line.
 */
export const DECATHLON_MARKETPLACE_COMMISSION_RATE = 0.16;

export type DecathlonMarginBreakdown = {
  /** Mirakl line sell after Decathlon fee (same as `decathlonGrossLineAmount`). */
  lineAfterDecathlon: number;
  supplierCost: number;
  margin: number;
  marginPercentOfLineAfter: number | null;
};

/** Raw Mirakl sell: `lineTotal`, else `unitPrice × quantity`. */
export function decathlonMiraklSellTotal(line: {
  lineTotal?: unknown;
  unitPrice?: unknown;
  quantity?: unknown;
}): number | null {
  const lt = line?.lineTotal != null ? Number(line.lineTotal) : NaN;
  if (Number.isFinite(lt)) return lt;
  const unit = line?.unitPrice != null ? Number(line.unitPrice) : NaN;
  const qtyRaw = line?.quantity != null ? Number(line.quantity) : 1;
  const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? qtyRaw : 1;
  if (Number.isFinite(unit)) return unit * qty;
  return null;
}

/**
 * “Gross (line)” for economics: Decathlon sell minus 16% marketplace fee.
 */
export function decathlonGrossLineAmount(line: {
  lineTotal?: unknown;
  unitPrice?: unknown;
  quantity?: unknown;
}): number | null {
  const sell = decathlonMiraklSellTotal(line);
  if (sell == null) return null;
  return sell * (1 - DECATHLON_MARKETPLACE_COMMISSION_RATE);
}

/** Margin vs StockX cost; first arg is already sell after Decathlon 16%. */
export function decathlonMarginFromGrossAndCost(
  lineAfterDecathlon: number,
  supplierCost: number
): DecathlonMarginBreakdown | null {
  if (!Number.isFinite(lineAfterDecathlon) || !Number.isFinite(supplierCost)) return null;
  const margin = lineAfterDecathlon - supplierCost;
  return {
    lineAfterDecathlon,
    supplierCost,
    margin,
    marginPercentOfLineAfter:
      lineAfterDecathlon > 0 ? (margin / lineAfterDecathlon) * 100 : null,
  };
}

export type DecathlonOrderMarginRollup = {
  /** Sum of per-line sell after Decathlon 16%. */
  linesNetAfterDecathlon: number;
  costLinkedLines: number;
  linesWithCost: number;
  lineCount: number;
  marginAfterFeeAndKnownCosts: number;
  marginPercentOfNetOrder: number | null;
  allLinesHaveCost: boolean;
};

export function decathlonOrderMarginRollup(
  lines: Array<{ id: string; lineTotal?: unknown; unitPrice?: unknown; quantity?: unknown }>,
  stockxLineCost: (lineId: string) => number | null
): DecathlonOrderMarginRollup {
  let linesNetAfterDecathlon = 0;
  let costLinkedLines = 0;
  let linesWithCost = 0;
  const lineCount = lines.length;
  for (const line of lines) {
    const g = decathlonGrossLineAmount(line);
    if (g != null) linesNetAfterDecathlon += g;
    const cost = stockxLineCost(String(line.id));
    if (cost != null) {
      costLinkedLines += cost;
      linesWithCost += 1;
    }
  }
  const marginAfterFeeAndKnownCosts = linesNetAfterDecathlon - costLinkedLines;
  const marginPercentOfNetOrder =
    linesNetAfterDecathlon > 0
      ? (marginAfterFeeAndKnownCosts / linesNetAfterDecathlon) * 100
      : null;
  return {
    linesNetAfterDecathlon,
    costLinkedLines,
    linesWithCost,
    lineCount,
    marginAfterFeeAndKnownCosts,
    marginPercentOfNetOrder,
    allLinesHaveCost: lineCount > 0 && linesWithCost === lineCount,
  };
}
