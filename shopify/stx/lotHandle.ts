/**
 * "…-4x-lot" slugs are separate StockX products from the single, with their own price.
 * Several KickDB products can share one Shopify product (ShopifySyncState.shopifyProductId),
 * so a sweep must only price a row onto the Shopify product whose slug has the same lot size.
 */
export function lotCountFromHandle(handle: string | null | undefined): number {
  const m = String(handle ?? "")
    .toLowerCase()
    .match(/(?:^|-)(\d+)x-lot(?:-|$)/);
  return m ? Number(m[1]) : 1;
}

/** True when the DB slug and the Shopify product handle describe the same lot size. */
export function sameLotSize(
  dbHandle: string | null | undefined,
  shopifyHandle: string | null | undefined
): boolean {
  return lotCountFromHandle(dbHandle) === lotCountFromHandle(shopifyHandle);
}
