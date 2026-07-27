import { isInStockEssentialLine } from "@/app/utils/matching";

/** Fear of God Essentials in-stock lane — fixed COGS, never StockX liquidation. */
export function isEssentialsProduct(
  sku: string | null | undefined,
  title?: string | null
): boolean {
  return isInStockEssentialLine(sku, title);
}

export function isEssentialsShopifyVariant(
  variant: { sku?: string | null; productTitle?: string | null } | null | undefined
): boolean {
  if (!variant) return false;
  return isEssentialsProduct(variant.sku ?? null, variant.productTitle ?? null);
}
