/**
 * Shadow data contract shared by every (disabled) outbound adapter and by reconciliation.
 * docs/tracking/TRACKING-PLAN.md §3 (taxonomy) + §7 (merge keys).
 */

export type ConsentSnapshot = {
  analytics: boolean | null;
  marketing: boolean | null;
  saleOfData: boolean | null;
};

export type ClickIds = Partial<Record<"gclid" | "gbraid" | "wbraid" | "fbclid" | "ttclid" | "msclkid", string>>;

export type ShadowItem = {
  /** Merchant feed id: shopify_CH_<productId>_<variantId>. */
  itemId: string;
  productId: string;
  variantId: string;
  name: string | null;
  brand: string | null;
  /** EU size label. */
  variant: string | null;
  lane: "express" | "standard" | null;
  price: number;
  quantity: number;
};

export type ShadowPurchase = {
  /** Numeric Shopify order id = transaction_id everywhere. */
  orderId: string;
  orderName: string | null;
  occurredAt: Date;
  currency: string;
  /** Gross revenue incl. VAT, after discounts, excl. nothing — what Simprosys reports today. */
  revenue: number;
  tax: number | null;
  shipping: number | null;
  items: ShadowItem[];
  /** Shopify pixel client id (first-party, from funnel_events). */
  clientId: string | null;
  sessionId: string | null;
  clickIds: ClickIds;
  consent: ConsentSnapshot;
  email: string | null;
  phone: string | null;
  country: string | null;
  ip: string | null;
  userAgent: string | null;
  pageUrl: string | null;
};

export const ITEM_ID_PREFIX = "shopify_CH_";

export function shortShopifyId(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v);
  const tail = s.slice(s.lastIndexOf("/") + 1);
  return /^\d+$/.test(tail) ? tail : null;
}

export function feedItemId(productId: string | number, variantId: string | number): string | null {
  const p = shortShopifyId(productId);
  const v = shortShopifyId(variantId);
  return p && v ? `${ITEM_ID_PREFIX}${p}_${v}` : null;
}

/**
 * Deterministic event id. Browser (pixel) and server sends of the same business event must
 * use the same id so Meta / TikTok deduplicate; Google dedups purchases on transaction_id.
 */
export function eventIdFor(kind: "purchase" | "refund" | "purchase_profit", orderId: string | number): string {
  const id = shortShopifyId(orderId);
  if (!id) throw new Error(`invalid Shopify order id: ${orderId}`);
  return `${kind}_${id}`;
}

export function orderGid(orderId: string | number): string {
  const id = shortShopifyId(orderId);
  if (!id) throw new Error(`invalid Shopify order id: ${orderId}`);
  return `gid://shopify/Order/${id}`;
}
