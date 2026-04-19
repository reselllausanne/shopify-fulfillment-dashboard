/**
 * Mirakl OR11 order lines expose identifiers under many keys; normalize extraction for DB + StockX linking.
 */

const GTIN_PATHS: (string | ((o: any) => unknown))[] = [
  "gtin",
  "ean",
  "product_ean",
  "productEan",
  "product_gtin",
  "productGtin",
  "international_article_number",
  "internationalArticleNumber",
  "product_ean_or_gtin",
  "productEanOrGtin",
  (o) => o?.product?.gtin,
  (o) => o?.product?.ean,
  (o) => o?.offer?.product?.gtin,
  (o) => o?.offer?.product?.ean,
  (o) => o?.product_data?.gtin,
  (o) => o?.product_data?.ean,
];

export function pickMiraklLineGtin(line: any): string | null {
  if (!line || typeof line !== "object") return null;
  for (const p of GTIN_PATHS) {
    const v = typeof p === "function" ? p(line) : line[p as string];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/** Keys that often match our SupplierVariant.providerKey / supplierVariantId (same as Galaxus feed). */
export function pickMiraklLineSkuCandidates(line: any): string[] {
  if (!line || typeof line !== "object") return [];
  const keys = [
    line.offer_sku,
    line.offerSku,
    line.product_sku,
    line.productSku,
    line.shop_sku,
    line.shopSku,
    line.supplier_sku,
    line.supplierSku,
    line.provider_key,
    line.providerKey,
    line.product_shop_sku,
    line.productShopSku,
    line.sku,
  ];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const k of keys) {
    const s = typeof k === "string" ? k.trim() : "";
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}
