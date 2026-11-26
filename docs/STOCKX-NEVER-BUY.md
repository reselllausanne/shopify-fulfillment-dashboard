# StockX never-buy list

Code: `lib/stockxAutoCheckout/neverBuyStockx.ts` (`NEVER_BUY_STOCKX`). Substring match, case-insensitive, on title/sku/mpn/gtin/supplierPid/providerKey.

| Product | MPN | Supplier SKU | GTIN | Why |
|---|---|---|---|---|
| Nike Varsity Elite Backpack White/Black/Metallic Silver (32 L) | HM9965-010 | STX_198480965312 | 198480965312 | In warehouse stock; auto buyer bought it on StockX anyway (2026-11-26). Galaxus product ID 66120208. |

Enforced in:
- `isClearlyNotStockxBuyable` (Shopify queue, Shopify checkout slug-missing/hold, Galaxus night `resolvePair`) → label `never_buy_stockx`.
- `resolveGalaxusStxBuyCandidate` (Galaxus batch + candidate listing) → reason `never_buy_stockx`.
- `buildNightQueue` (pair never enqueued).

VPS data (not code): `/app/.data/galaxus-skip-orders.txt` + `night-buyer-state.json` entries `status=done reason=never_buy_stockx`.
