import { shopifyGraphQL } from "@/lib/shopifyAdmin";

const ORDER_LOCALE_QUERY = /* GraphQL */ `
  query OrderCustomerLocale($id: ID!) {
    order(id: $id) {
      customerLocale
    }
  }
`;

const successCache = new Map<string, string>();

function toOrderGid(orderId: string): string | null {
  const raw = orderId.trim();
  if (!raw) return null;
  if (raw.startsWith("gid://")) return raw;
  if (/^\d+$/.test(raw)) return `gid://shopify/Order/${raw}`;
  return raw;
}

/** Shopify checkout locale for the order. Null if missing or the lookup fails. */
export async function fetchShopifyCustomerLocale(
  orderId: string | null | undefined
): Promise<string | null> {
  const id = toOrderGid(String(orderId || ""));
  if (!id) return null;
  const cached = successCache.get(id);
  if (cached) return cached;
  try {
    const result = await shopifyGraphQL<{
      order: { customerLocale?: string | null } | null;
    }>(ORDER_LOCALE_QUERY, { id });
    const locale = String(result.data?.order?.customerLocale || "").trim();
    if (!locale) return null;
    successCache.set(id, locale);
    return locale;
  } catch (error) {
    console.warn(
      "[EMAIL] customerLocale lookup failed",
      error instanceof Error ? error.message : error
    );
    return null;
  }
}
