import { isInStockFixedPriceProduct } from "@/shopify/inventory/inStockFixedPrice";

/** Fixed-price in-stock lane — never StockX liquidation. */
export function isEssentialsProduct(
  sku: string | null | undefined,
  title?: string | null,
  productId?: string | null
): boolean {
  return isInStockFixedPriceProduct({ sku, title, productId });
}

export function isEssentialsShopifyVariant(
  variant: {
    sku?: string | null;
    productTitle?: string | null;
    productId?: string | null;
  } | null | undefined
): boolean {
  if (!variant) return false;
  return isEssentialsProduct(
    variant.sku ?? null,
    variant.productTitle ?? null,
    variant.productId ?? null
  );
}
