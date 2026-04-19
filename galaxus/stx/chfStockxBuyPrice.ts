/**
 * Caveman CH calibration from a real StockX checkout:
 * Item CHF 217.00 + Processing CHF 23.11 + Shipping CHF 20.00 → subtotal CHF 260.11.
 *
 * We model buyer cost as: list × (1 + processingShareOfList) + flatShippingChf,
 * where processingShareOfList = 23.11 / 217 ≈ 10.65%.
 */
export const STX_CH_EXAMPLE_LIST_CHF = 217;
export const STX_CH_EXAMPLE_PROCESSING_CHF = 23.11;

/** Processing fee ÷ list price from the example (~0.1065). */
export const STX_CH_PROCESSING_FEE_SHARE_OF_LIST =
  STX_CH_EXAMPLE_PROCESSING_CHF / STX_CH_EXAMPLE_LIST_CHF;

/** Multiply API list/ask (CHF) before adding product shipping (e.g. 20). ≈ 1.1065. */
export const STX_CH_LIST_MULTIPLIER_BEFORE_SHIPPING = 1 + STX_CH_PROCESSING_FEE_SHARE_OF_LIST;

/** Stored SupplierVariant.price: estimated StockX buy in CHF (2 dp). */
export function estimatedStockxBuyChfFromList(listChf: number, shippingChf: number): number {
  return Math.round((listChf * STX_CH_LIST_MULTIPLIER_BEFORE_SHIPPING + shippingChf) * 100) / 100;
}
