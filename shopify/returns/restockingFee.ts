/** Default restocking fee on every Shopify return (business rule: 10%). */
export const DEFAULT_RETURN_RESTOCKING_FEE_PERCENT = (() => {
  const configured = Number(process.env.SHOPIFY_RETURN_RESTOCKING_FEE_PERCENT ?? "10");
  return Number.isFinite(configured) && configured >= 0 ? configured : 10;
})();

export function defaultReturnRestockingFeeInput(): { percentage: number } {
  return { percentage: DEFAULT_RETURN_RESTOCKING_FEE_PERCENT };
}

export type RestockingFeeComputation = {
  restockingFeeTotal: number;
  netAmount: number;
  appliedDefaultPercent: boolean;
};

/** Sum Shopify line fees; fall back to default % on gross when none configured. */
export function computeReturnRestockingFeeTotal(input: {
  lineItems: Array<Record<string, unknown>>;
  grossAmount: number;
}): RestockingFeeComputation {
  const grossAmount = Number(input.grossAmount);
  let restockingFeeTotal = 0;

  for (const line of input.lineItems) {
    const lineFee = Number(line?.restockingFeeAmount);
    if (Number.isFinite(lineFee) && lineFee > 0) {
      restockingFeeTotal += lineFee * (Number(line?.quantity) || 1);
      continue;
    }
    const percent = Number(line?.restockingFeePercent);
    if (Number.isFinite(percent) && percent > 0) {
      const unit = Number(line?.unitAmount) || 0;
      const qty = Number(line?.quantity) || 1;
      restockingFeeTotal += (unit * qty * percent) / 100;
    }
  }

  restockingFeeTotal = Number(restockingFeeTotal.toFixed(2));

  if (
    restockingFeeTotal <= 0 &&
    Number.isFinite(grossAmount) &&
    grossAmount > 0 &&
    DEFAULT_RETURN_RESTOCKING_FEE_PERCENT > 0
  ) {
    restockingFeeTotal = Number(
      ((grossAmount * DEFAULT_RETURN_RESTOCKING_FEE_PERCENT) / 100).toFixed(2)
    );
    return {
      restockingFeeTotal,
      netAmount: Number(Math.max(0, grossAmount - restockingFeeTotal).toFixed(2)),
      appliedDefaultPercent: true,
    };
  }

  return {
    restockingFeeTotal,
    netAmount: Number(Math.max(0, grossAmount - restockingFeeTotal).toFixed(2)),
    appliedDefaultPercent: false,
  };
}
