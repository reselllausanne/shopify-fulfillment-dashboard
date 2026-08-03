import {
  DECATHLON_MARKETPLACE_COMMISSION_RATE,
  DECATHLON_VAT_RATE,
  decathlonEstimatedPayoutRate,
} from "@/decathlon/orders/margin";

/**
 * Liquidation / website sell = target seller payout after Mirakl fees.
 * Mirakl list TTC = payout / (1 − 17% − 8%) ≈ payout / 0.75.
 */
export function decathlonListPriceFromTargetPayout(payoutChf: number): number | null {
  if (!Number.isFinite(payoutChf) || payoutChf <= 0) return null;
  const rate = decathlonEstimatedPayoutRate();
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return Math.round((payoutChf / rate) * 100) / 100;
}

export function decathlonPhysicalLiquidationFeeRates() {
  return {
    commissionRate: DECATHLON_MARKETPLACE_COMMISSION_RATE,
    vatRate: DECATHLON_VAT_RATE,
    payoutRate: decathlonEstimatedPayoutRate(),
  };
}
