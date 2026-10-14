/**
 * Internal contribution margin (CM2) per order — REPORTING ONLY.
 *
 * Policy (docs/tracking/TRACKING-PLAN.md §6): never replaces revenue, never sent as a Primary
 * conversion, never used as a bidding value. The only future outbound use is a SECONDARY
 * `purchase_profit` conversion in observation mode after gate G5.
 *
 * CM1 = revenue ex VAT − supplier cost
 * CM2 = CM1 − payment fees − outbound shipping cost − return reserve
 */

export type ProfitLine = {
  /** Line revenue incl. VAT after discounts (OrderMatch.shopifyTotalPrice). */
  revenueGross: number;
  /** Supplier cost (manualCostOverride ?? supplierCost); null/0 = unknown. */
  supplierCost: number | null;
  /** Owned-stock / accessory lines where a 0 cost is real (rare; default false). */
  zeroCostIsReal?: boolean;
};

export type ProfitAssumptions = {
  vatRate: number;
  paymentFeePct: number;
  paymentFeeFixed: number;
  shippingCostPerOrder: number;
  returnReservePct: number;
};

/** Defaults are estimates; override with env TRACKING_CM2_* (see profitAssumptionsFromEnv). */
export const DEFAULT_PROFIT_ASSUMPTIONS: ProfitAssumptions = {
  vatRate: 0.081,
  paymentFeePct: 0.029,
  paymentFeeFixed: 0.3,
  shippingCostPerOrder: 9,
  returnReservePct: 0.02,
};

export type OrderProfit = {
  revenueGross: number;
  revenueNet: number;
  supplierCost: number;
  cm1: number;
  paymentFees: number;
  shippingCost: number;
  returnReserve: number;
  cm2: number;
  cm2Pct: number | null;
  /** false when any line lacks a real supplier cost → CM is overstated, exclude from stats. */
  costComplete: boolean;
  unknownCostLines: number;
};

type Env = Record<string, string | undefined>;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeOrderProfit(
  lines: ProfitLine[],
  assumptions: ProfitAssumptions = DEFAULT_PROFIT_ASSUMPTIONS,
): OrderProfit {
  let revenueGross = 0;
  let supplierCost = 0;
  let unknownCostLines = 0;
  for (const l of lines) {
    const rev = Number.isFinite(l.revenueGross) ? l.revenueGross : 0;
    revenueGross += rev;
    const cost = l.supplierCost ?? 0;
    if (!(cost > 0) && !l.zeroCostIsReal) unknownCostLines++;
    supplierCost += cost > 0 ? cost : 0;
  }
  const revenueNet = revenueGross / (1 + assumptions.vatRate);
  const cm1 = revenueNet - supplierCost;
  const paymentFees = revenueGross > 0 ? revenueGross * assumptions.paymentFeePct + assumptions.paymentFeeFixed : 0;
  const shippingCost = lines.length > 0 ? assumptions.shippingCostPerOrder : 0;
  const returnReserve = revenueNet * assumptions.returnReservePct;
  const cm2 = cm1 - paymentFees - shippingCost - returnReserve;
  return {
    revenueGross: round2(revenueGross),
    revenueNet: round2(revenueNet),
    supplierCost: round2(supplierCost),
    cm1: round2(cm1),
    paymentFees: round2(paymentFees),
    shippingCost: round2(shippingCost),
    returnReserve: round2(returnReserve),
    cm2: round2(cm2),
    cm2Pct: revenueGross > 0 ? Math.round((cm2 / revenueGross) * 1000) / 1000 : null,
    costComplete: lines.length > 0 && unknownCostLines === 0,
    unknownCostLines,
  };
}

function envNum(env: Env, key: string, fallback: number): number {
  const raw = String(env[key] ?? "").trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function profitAssumptionsFromEnv(env: Env = process.env): ProfitAssumptions {
  const d = DEFAULT_PROFIT_ASSUMPTIONS;
  return {
    vatRate: envNum(env, "TRACKING_CM2_VAT_RATE", d.vatRate),
    paymentFeePct: envNum(env, "TRACKING_CM2_PAYMENT_FEE_PCT", d.paymentFeePct),
    paymentFeeFixed: envNum(env, "TRACKING_CM2_PAYMENT_FEE_FIXED", d.paymentFeeFixed),
    shippingCostPerOrder: envNum(env, "TRACKING_CM2_SHIPPING_COST", d.shippingCostPerOrder),
    returnReservePct: envNum(env, "TRACKING_CM2_RETURN_RESERVE_PCT", d.returnReservePct),
  };
}

/**
 * Value a future SECONDARY purchase_profit conversion would carry. Ads rejects negative values,
 * so loss-making orders clamp to 0; incomplete cost → null (do not send at all).
 */
export function secondaryProfitConversionValue(p: OrderProfit): number | null {
  if (!p.costComplete) return null;
  return Math.max(0, p.cm2);
}
