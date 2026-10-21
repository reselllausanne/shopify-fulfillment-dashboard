import type { ShopifyDeliveryMode } from "@/app/lib/shopifyLineItemDelivery";
import type { StockxDesiredLane } from "@/lib/stockxAutoCheckout/types";

const EXPRESS_RE = /\b(express|xpress)\b/i;

/**
 * Shopify Express vs Standard for StockX lane targeting.
 * Primary: line `_delivery` / "Mode d'expédition" via parseShopifyLineItemDelivery.
 * Fallback: shipping line titles / FO presentedName containing Express/Xpress.
 * Ambiguous → Standard (never buy StockX Express without clear Shopify Express).
 */
export function detectShopifyExpress(input: {
  deliveryMode?: ShopifyDeliveryMode | string | null;
  deliveryModeLabel?: string | null;
  shippingLineTitles?: Array<string | null | undefined> | null;
  fulfillmentPresentedNames?: Array<string | null | undefined> | null;
}): boolean {
  const mode = String(input.deliveryMode ?? "")
    .trim()
    .toLowerCase();
  if (mode === "express") return true;
  if (mode === "standard") return false;

  const blobs = [
    input.deliveryModeLabel,
    ...(input.shippingLineTitles ?? []),
    ...(input.fulfillmentPresentedNames ?? []),
  ];
  for (const raw of blobs) {
    const t = String(raw ?? "").trim();
    if (t && EXPRESS_RE.test(t)) return true;
  }
  return false;
}

export function desiredStockxLaneFromShopify(isShopifyExpress: boolean): StockxDesiredLane {
  return isShopifyExpress ? "EXPRESS" : "STANDARD";
}
