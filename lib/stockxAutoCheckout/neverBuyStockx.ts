/**
 * Hard never-buy list: products that must NEVER be bought on StockX (any buyer:
 * Galaxus night buyer, Shopify batch/express buyer, manual checkout helpers).
 *
 * Match is a case-insensitive substring on title, sku, mpn, gtin, supplierPid,
 * providerKey. Keep entries specific (MPN / GTIN / STX_ sku), never a brand word.
 *
 * 2026-11-26: Nike Varsity Elite Backpack White/Black/Metallic Silver (32 L),
 * HM9965-010. Warehouse stock exists; the auto buyer bought bags on StockX anyway.
 */
export const NEVER_BUY_STOCKX: ReadonlyArray<{ token: string; label: string }> = [
  { token: "HM9965-010", label: "nike_varsity_elite_backpack_hm9965" },
  { token: "STX_198480965312", label: "nike_varsity_elite_backpack_hm9965" },
  { token: "198480965312", label: "nike_varsity_elite_backpack_hm9965" },
];

export const NEVER_BUY_STOCKX_REASON = "never_buy_stockx";

export type NeverBuyLine = {
  title?: string | null;
  sku?: string | null;
  mpn?: string | null;
  gtin?: string | null;
  supplierPid?: string | null;
  providerKey?: string | null;
};

export function isNeverBuyStockx(line: NeverBuyLine): { blocked: boolean; label?: string } {
  const hay = [line.title, line.sku, line.mpn, line.gtin, line.supplierPid, line.providerKey]
    .map((v) => String(v ?? "").trim())
    .filter(Boolean)
    .join(" ")
    .toUpperCase();
  if (!hay) return { blocked: false };
  for (const e of NEVER_BUY_STOCKX) {
    if (hay.includes(e.token.toUpperCase())) return { blocked: true, label: e.label };
  }
  return { blocked: false };
}
