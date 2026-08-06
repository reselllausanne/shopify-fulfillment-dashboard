import { formatInTimeZone } from "date-fns-tz";

/** Business timezone for Shopify sell-date grouping on the margin dashboard. */
export const SHOPIFY_SELL_TIMEZONE = "Europe/Zurich";

/**
 * OrderMatch.shopifyCreatedAt convention: Zurich wall-clock stored as UTC.
 * save-match writes this shape so daily keys via ISO UTC date = Zurich calendar day.
 */
export function toShopifyCreatedAtStorage(raw: Date): Date {
  const localStr = formatInTimeZone(raw, SHOPIFY_SELL_TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
  return new Date(`${localStr}.000Z`);
}

/** YYYY-MM-DD business day key for a stored shopifyCreatedAt value. */
export function shopifySellDateKey(shopifyCreatedAt: Date): string {
  return shopifyCreatedAt.toISOString().split("T")[0];
}

/** Inclusive UTC day window matching shopifySellDateKey / daily-details. */
export function shopifySellDateUtcWindow(dateStr: string): { start: Date; end: Date } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return null;
  return {
    start: new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0)),
    end: new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999)),
  };
}
