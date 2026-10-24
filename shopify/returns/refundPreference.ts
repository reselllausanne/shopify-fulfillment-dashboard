/** Max CHF credit / refund issued back to the original payment method. Above → store credit. */
export const ORIGINAL_PAYMENT_REFUND_MAX_CHF = 50;

export type RefundPreference = "original_payment" | "store_credit";

export function refundPreferenceForAmount(amountChf: number): RefundPreference {
  if (!Number.isFinite(amountChf) || amountChf <= 0) return "store_credit";
  return amountChf <= ORIGINAL_PAYMENT_REFUND_MAX_CHF
    ? "original_payment"
    : "store_credit";
}

/** Unit price delta: replacement − ordered. Positive = customer pays. */
export function unitPriceDelta(
  orderedUnit: number | null | undefined,
  replacementUnit: number | null | undefined
): number | null {
  if (orderedUnit == null || replacementUnit == null) return null;
  if (!Number.isFinite(orderedUnit) || !Number.isFinite(replacementUnit)) return null;
  return Number((replacementUnit - orderedUnit).toFixed(2));
}
