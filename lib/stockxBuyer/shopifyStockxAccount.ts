/** Temporary: buy Shopify lines on the Galaxus StockX account. Default stays the Shopify profile. */
export function shopifyStockxAccount(env: NodeJS.ProcessEnv = process.env): "default" | "galaxus" {
  return String(env.STOCKX_BUYER_SHOPIFY_ACCOUNT || "").trim().toLowerCase() === "galaxus" ? "galaxus" : "default";
}

/** Promo mailbox for a Shopify-order checkout. Follows the StockX account actually used. */
export function promoAccountForShopifyCheckout(env: NodeJS.ProcessEnv = process.env): "shopify" | "galaxus" {
  return shopifyStockxAccount(env) === "galaxus" ? "galaxus" : "shopify";
}

/** Explicit test token, else every known StockX account (dashboard + galaxus). */
export function tokensForShopifyAutoLink(explicit: string | null | undefined, listed: string[]): string[] {
  const one = String(explicit ?? "").trim();
  if (one) return [one];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of listed) {
    const token = String(raw ?? "").trim();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}
