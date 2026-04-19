import { decathlonMiraklSellerPayoutLineTotal } from "./miraklLinePayout";

/**
 * Decathlon payout (ligne) ≈ même logique que le récap Mirakl :
 * total ligne − commission (~17 % du total) − taxes (~8 % du total).
 * Modèle simplifié : `sellBrut × (1 − 0,17 − 0,08)`.
 */
export const DECATHLON_MARKETPLACE_COMMISSION_RATE = 0.17;
export const DECATHLON_VAT_RATE = 0.08;
const DECATHLON_PAYOUT_RATE =
  1 - DECATHLON_MARKETPLACE_COMMISSION_RATE - DECATHLON_VAT_RATE;

export type DecathlonMarginBreakdown = {
  /** Payout Decathlon estimé pour la ligne (après commission + TVA). */
  lineAfterDecathlon: number;
  supplierCost: number;
  margin: number;
  /** Marge / payout ligne × 100 */
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
 * Payout Decathlon estimé pour une ligne (après −17 % et −8 % sur le brut Mirakl).
 */
export function decathlonPayoutLineAmount(line: {
  lineTotal?: unknown;
  unitPrice?: unknown;
  quantity?: unknown;
}): number | null {
  const sell = decathlonMiraklSellTotal(line);
  if (sell == null) return null;
  return sell * DECATHLON_PAYOUT_RATE;
}

/** @deprecated Utiliser `decathlonPayoutLineAmount` */
export const decathlonGrossLineAmount = decathlonPayoutLineAmount;

/**
 * Payout ligne pour affichage / marge : montant Mirakl (`total_price − total_commission` sur `rawJson`) si présent,
 * sinon estimation `decathlonPayoutLineAmount`.
 */
export function decathlonLinePayoutPreferMirakl(line: {
  rawJson?: unknown;
  lineTotal?: unknown;
  unitPrice?: unknown;
  quantity?: unknown;
}): number | null {
  const m = decathlonMiraklSellerPayoutLineTotal(line.rawJson);
  if (m != null) return m;
  return decathlonPayoutLineAmount(line);
}

/** Marge vs coût StockX ; premier arg = payout ligne Decathlon. */
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
  /** Somme des payouts ligne (Mirakl si dispo, sinon estimation 17 % / 8 %). */
  linesNetAfterDecathlon: number;
  costLinkedLines: number;
  linesWithCost: number;
  lineCount: number;
  marginAfterFeeAndKnownCosts: number;
  /** Marge totale / payout total × 100 */
  marginPercentOfNetOrder: number | null;
  allLinesHaveCost: boolean;
};

export function decathlonOrderMarginRollup(
  lines: Array<{
    id: string;
    rawJson?: unknown;
    lineTotal?: unknown;
    unitPrice?: unknown;
    quantity?: unknown;
  }>,
  stockxLineCost: (lineId: string) => number | null
): DecathlonOrderMarginRollup {
  let linesNetAfterDecathlon = 0;
  let costLinkedLines = 0;
  let linesWithCost = 0;
  const lineCount = lines.length;
  for (const line of lines) {
    const g = decathlonLinePayoutPreferMirakl(line);
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
