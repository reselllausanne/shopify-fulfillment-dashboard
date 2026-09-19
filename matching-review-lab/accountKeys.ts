import type { StockxAccountKey } from "./types";

/**
 * Lab account keys — explicit Shopify vs Galaxus separation.
 * Mirrors production intent:
 * - Shopify inbound uses customerUuid or shopify:{source}
 * - Galaxus prefers galaxus token file (source: "galaxus")
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
  if (source) return `galaxus:${source}`;
  return "galaxus:default";
}

export function isShopifyAccountKey(key: StockxAccountKey | string | null | undefined): boolean {
  return String(key ?? "").startsWith("shopify:");
}

export function isGalaxusAccountKey(key: StockxAccountKey | string | null | undefined): boolean {
  return String(key ?? "").startsWith("galaxus:");
}

/** Wrong-account filter: Shopify units must not consume galaxus:* buys (and vice versa). */
export function accountKeyMatchesChannel(
  channel: "SHOPIFY" | "GALAXUS",
  accountKey: StockxAccountKey | string | null | undefined
): boolean {
  if (channel === "SHOPIFY") return isShopifyAccountKey(accountKey);
  return isGalaxusAccountKey(accountKey);
}
