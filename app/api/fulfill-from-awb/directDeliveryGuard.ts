import {
  findStockxInboundHomeRouteByCode,
  findStockxInboundHomeRouteByShopifyOrderName,
  type StockxInboundHomeRoute,
} from "@/app/lib/stockxInboundHomeRoutes";

export type DirectDeliveryGuardInput = {
  awb: string;
  shopifyOrderName?: string | null;
  gtinFulfill?: boolean;
};

/**
 * Detect warehouse-context direct-delivery routes that must never go through
 * Shopify fulfill-from-awb.
 */
export async function findBlockedDirectDeliveryRoute(
  input: DirectDeliveryGuardInput
): Promise<StockxInboundHomeRoute | null> {
  const shopifyOrderName = String(input.shopifyOrderName ?? "").trim() || null;

  // GTIN fulfill scans product code, not inbound AWB. Guard by order name only.
  if (!input.gtinFulfill) {
    const byCode = await findStockxInboundHomeRouteByCode(input.awb);
    if (byCode) return byCode;
  }

  if (shopifyOrderName) {
    const byOrderName = await findStockxInboundHomeRouteByShopifyOrderName(shopifyOrderName);
    if (byOrderName) return byOrderName;
  }

  return null;
}
