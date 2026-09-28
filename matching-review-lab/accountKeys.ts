import type { StockxAccountKey } from "./types";

/**
 * Two StockX accounts — never mixed:
 * - Shopify (dashboard/db token) → shopify:*
 * - Galaxus (stockx-token-galaxus.json) → galaxus:*
 *
 * Decathlon STX lines consume the Galaxus StockX account (shared claim pool
 * with GalaxusStockxMatch / DecathlonStockxMatch — not OrderMatch).
 */

export function stockxAccountKeyForShopify(params: {
  customerUuid?: string | null;
  source?: "db" | "dashboard" | string | null;
}): StockxAccountKey {
  const uuid = String(params.customerUuid ?? "").trim().toLowerCase();
  if (uuid) return `shopify:${uuid}`;
  const source = String(params.source ?? "").trim().toLowerCase();
  if (source === "db" || source === "dashboard") return `shopify:${source}`;
  return "shopify:default";
}

export function stockxAccountKeyForGalaxus(params: {
  customerUuid?: string | null;
  source?: "galaxus" | "db" | "dashboard" | string | null;
}): StockxAccountKey {
  const uuid = String(params.customerUuid ?? "").trim().toLowerCase();
  if (uuid) return `galaxus:${uuid}`;
  const source = String(params.source ?? "").trim().toLowerCase();
  if (source === "galaxus") return "galaxus:galaxus";
  if (source) return `galaxus:${source}`;
  return "galaxus:default";
}

export function isShopifyAccountKey(key: StockxAccountKey | string | null | undefined): boolean {
  return String(key ?? "").startsWith("shopify:");
}

export function isGalaxusAccountKey(key: StockxAccountKey | string | null | undefined): boolean {
  return String(key ?? "").startsWith("galaxus:");
}

/**
 * Strict channel ↔ StockX account:
 * - SHOPIFY → shopify:* only
 * - GALAXUS → galaxus:* only
 * - DECATHLON → galaxus:* only (same StockX account as Galaxus)
 */
export function accountKeyMatchesChannel(
  channel: "SHOPIFY" | "GALAXUS" | "DECATHLON",
  accountKey: StockxAccountKey | string | null | undefined
): boolean {
  if (channel === "SHOPIFY") return isShopifyAccountKey(accountKey);
  // Galaxus + Decathlon share the Galaxus StockX account.
  return isGalaxusAccountKey(accountKey);
}

/** Label a server token by its source file / origin — never cross-tag. */
export function accountKeyFromTokenSource(params: {
  source: "db" | "dashboard" | "galaxus" | string;
  customerUuid?: string | null;
}): StockxAccountKey {
  if (params.source === "galaxus") {
    return stockxAccountKeyForGalaxus({
      customerUuid: params.customerUuid,
      source: "galaxus",
    });
  }
  return stockxAccountKeyForShopify({
    customerUuid: params.customerUuid,
    source: params.source === "db" || params.source === "dashboard" ? params.source : "dashboard",
  });
}
