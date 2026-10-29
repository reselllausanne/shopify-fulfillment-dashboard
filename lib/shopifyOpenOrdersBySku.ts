/**
 * Live Shopify Admin discovery of open (unfulfilled/partial) order lines by SKU.
 *
 * OrderMatch is only created for physical / Money Kickz / StockX-linked dropship.
 * Warehouse scan must still surface Website-stock lines that were never linked.
 */

import {
  shopifyMatchMinCreatedAt,
  SHOPIFY_MATCH_MAX_AGE_MONTHS,
} from "@/app/lib/shopifyMatchEligibility";
import { shopifySkuBase, skuEquals } from "@/app/lib/shopifyAwbFallback";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";

export type LiveShopifyOpenLine = {
  shopifyOrderId: string;
  shopifyOrderName: string;
  shopifyLineItemId: string;
  shopifySku: string | null;
  productTitle: string | null;
  sizeTitle: string | null;
  createdAt: string;
  remainingQuantity: number;
  customerName: string | null;
};

type OrdersBySkuQuery = {
  orders: {
    edges: Array<{
      node: {
        id: string;
        name: string;
        createdAt: string;
        cancelledAt: string | null;
        displayFulfillmentStatus: string | null;
        customer: {
          firstName?: string | null;
          lastName?: string | null;
          displayName?: string | null;
        } | null;
        lineItems: {
          edges: Array<{
            node: {
              id: string;
              title: string | null;
              sku: string | null;
              quantity: number;
              currentQuantity: number;
              unfulfilledQuantity: number;
              variant: { sku: string | null; title: string | null; barcode: string | null } | null;
            };
          }>;
        };
      };
    }>;
  };
};

const ORDERS_BY_SKU_QUERY = /* GraphQL */ `
query ScanOpenOrdersBySku($q: String!, $first: Int!) {
  orders(first: $first, query: $q, sortKey: CREATED_AT, reverse: false) {
    edges {
      node {
        id
        name
        createdAt
        cancelledAt
        displayFulfillmentStatus
        customer {
          firstName
          lastName
          displayName
        }
        lineItems(first: 50) {
          edges {
            node {
              id
              title
              sku
              quantity
              currentQuantity
              unfulfilledQuantity
              variant {
                sku
                title
                barcode
              }
            }
          }
        }
      }
    }
  }
}
`;

function escapeShopifySearchToken(value: string): string {
  return String(value ?? "")
    .trim()
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

/** Prefer size-specific SKUs when present so a size barcode does not auto-claim every size. */
export function preferSizedShopifySkus(skus: string[]): string[] {
  const cleaned = Array.from(
    new Set(skus.map((s) => String(s ?? "").trim()).filter(Boolean))
  );
  const sized = cleaned.filter((s) => {
    const base = shopifySkuBase(s);
    return Boolean(base && base !== s);
  });
  return sized.length > 0 ? sized : cleaned;
}

export function buildOpenOrdersSkuSearchQuery(params: {
  skus: string[];
  minCreatedAt?: Date;
}): string | null {
  const needles = preferSizedShopifySkus(params.skus);
  if (needles.length === 0) return null;

  const minCreatedAt = params.minCreatedAt ?? shopifyMatchMinCreatedAt();
  const ymd = minCreatedAt.toISOString().slice(0, 10);

  const skuClauses = needles.map((sku) => {
    const token = escapeShopifySearchToken(sku);
    const base = shopifySkuBase(sku);
    // Exact sized SKU; style-only gets prefix so JR3733 finds JR3733-41 1/3.
    if (base && base !== sku) {
      return `sku:${token}`;
    }
    return `sku:${token}*`;
  });

  const skuGroup =
    skuClauses.length === 1 ? skuClauses[0] : `(${skuClauses.join(" OR ")})`;

  return [
    "(fulfillment_status:unfulfilled OR fulfillment_status:partial)",
    "-status:cancelled",
    `created:>=${ymd}`,
    skuGroup,
  ].join(" ");
}

export function lineSkuMatchesNeedles(lineSku: string | null | undefined, needles: string[]): boolean {
  const sku = String(lineSku ?? "").trim();
  if (!sku || needles.length === 0) return false;
  const preferred = preferSizedShopifySkus(needles);
  const preferredAreSized = preferred.some((n) => {
    const base = shopifySkuBase(n);
    return Boolean(base && base !== n);
  });
  if (preferredAreSized) {
    // Size barcode / sized catalog hit: require exact SKU (ignore style-only cross-size).
    const norm = (v: string) =>
      String(v)
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
    const lineNorm = norm(sku);
    return preferred.some((n) => norm(n) === lineNorm);
  }
  return preferred.some((n) => skuEquals(n, sku));
}

/**
 * Query live Shopify for open lines whose SKU matches any of `skus`.
 * Does not require an OrderMatch row.
 */
export async function searchLiveOpenShopifyLinesBySkus(params: {
  skus: string[];
  minCreatedAt?: Date;
  take?: number;
}): Promise<LiveShopifyOpenLine[]> {
  const needles = preferSizedShopifySkus(params.skus);
  if (needles.length === 0) return [];

  const orderQuery = buildOpenOrdersSkuSearchQuery({
    skus: needles,
    minCreatedAt: params.minCreatedAt,
  });
  if (!orderQuery) return [];

  const take = Math.max(1, Math.min(50, Math.floor(params.take ?? 25)));
  const { data, errors } = await shopifyGraphQL<OrdersBySkuQuery>(ORDERS_BY_SKU_QUERY, {
    q: orderQuery,
    first: take,
  });
  if (errors?.length) {
    throw new Error(`Shopify open-SKU search failed: ${JSON.stringify(errors)}`);
  }

  const out: LiveShopifyOpenLine[] = [];
  const seenLine = new Set<string>();

  for (const edge of data?.orders?.edges ?? []) {
    const order = edge?.node;
    if (!order?.id || order.cancelledAt) continue;
    const status = String(order.displayFulfillmentStatus ?? "").toUpperCase();
    if (status === "FULFILLED") continue;

    const customerName = [
      order.customer?.firstName,
      order.customer?.lastName,
    ]
      .map((x) => String(x ?? "").trim())
      .filter(Boolean)
      .join(" ")
      || String(order.customer?.displayName ?? "").trim()
      || null;

    for (const liEdge of order.lineItems?.edges ?? []) {
      const li = liEdge?.node;
      if (!li?.id) continue;
      const lineSku = String(li.variant?.sku || li.sku || "").trim() || null;
      if (!lineSkuMatchesNeedles(lineSku, needles)) continue;
      const remaining = Math.max(0, Number(li.unfulfilledQuantity ?? 0));
      if (remaining <= 0) continue;
      if (seenLine.has(li.id)) continue;
      seenLine.add(li.id);
      out.push({
        shopifyOrderId: order.id,
        shopifyOrderName: order.name,
        shopifyLineItemId: li.id,
        shopifySku: lineSku,
        productTitle: li.title ?? null,
        sizeTitle: li.variant?.title ?? null,
        createdAt: order.createdAt,
        remainingQuantity: remaining,
        customerName,
      });
    }
  }

  out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return out;
}

/** Exported for tests / docs — months window used in search query. */
export const LIVE_SHOPIFY_OPEN_MAX_AGE_MONTHS = SHOPIFY_MATCH_MAX_AGE_MONTHS;
