import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import {
  resolveGtinsForLineItems,
  resolveGtinSalesForLineItems,
  type OrderPaidLineItem,
  type OrdersPaidConvergenceResult,
} from "@/shopify/orders/ordersPaidConvergence";
import { refreshAfterShopifySale } from "@/shopify/orders/postSaleRefresh";
import { schedulePostSaleMarketplacePricePush } from "@/inventory/postSaleMarketplacePricePush";
import {
  loadPaidLineStates,
  markPaidLineProcessed,
  shouldProcessPaidLine,
} from "@/shopify/orders/paidLineState";

type RecentPaidOrdersData = {
  orders: {
    edges: Array<{
      node: {
        id: string;
        name: string;
        updatedAt: string;
        lineItems: {
          edges: Array<{
            node: {
              id: string;
              sku: string | null;
              quantity: number;
              variant: { id: string; sku: string | null; barcode: string | null } | null;
            };
          }>;
        };
      };
    }>;
  };
};

const RECENT_PAID_ORDERS_QUERY = /* GraphQL */ `
query RecentPaidOrders($first: Int!, $query: String!) {
  orders(first: $first, query: $query, sortKey: UPDATED_AT, reverse: true) {
    edges {
      node {
        id
        name
        updatedAt
        lineItems(first: 100) {
          edges {
            node {
              id
              sku
              quantity
              variant {
                id
                sku
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

function toRestVariantId(gid: string | null | undefined): string | null {
  if (!gid) return null;
  const m = gid.match(/ProductVariant\/(\d+)/);
  return m?.[1] ?? null;
}

function lineItemsFromGraphql(
  edges: RecentPaidOrdersData["orders"]["edges"][number]["node"]["lineItems"]["edges"]
): OrderPaidLineItem[] {
  return edges.map(({ node }) => ({
    id: node.id,
    variant_id: toRestVariantId(node.variant?.id ?? null),
    sku: node.sku ?? node.variant?.sku ?? null,
    quantity: node.quantity,
  }));
}

export type RecentPaidConvergenceResult = {
  scanned: number;
  processed: number;
  gtins: number;
  changed: number;
  errors: number;
  skipped: number;
  orders: OrdersPaidConvergenceResult[];
};

/**
 * Backup when orders/paid webhook fails. Dedupes GTINs from recent paid orders
 * and runs the same post-sale refresh as the webhook (Shopify price + STX DB + Galaxus stock).
 */
export async function convergeRecentPaidShopifyOrders(options?: {
  sinceMinutes?: number;
  limit?: number;
}): Promise<RecentPaidConvergenceResult> {
  const sinceMinutes = Math.min(Math.max(options?.sinceMinutes ?? 30, 5), 180);
  const limit = Math.min(Math.max(options?.limit ?? 40, 1), 100);
  const since = new Date(Date.now() - sinceMinutes * 60 * 1000).toISOString();
  const query = `financial_status:paid updated_at:>=${since}`;

  const { data, errors } = await shopifyGraphQL<RecentPaidOrdersData>(RECENT_PAID_ORDERS_QUERY, {
    first: limit,
    query,
  });
  if (errors?.length) {
    throw new Error(errors.map((e) => e.message).join("; "));
  }

  const orders = data?.orders?.edges ?? [];
  const gtinSet = new Set<string>();
  const orderSales = new Map<
    string,
    Array<{ gtin: string; quantity: number; lineItemId: string | null; variantId: string | null }>
  >();

  for (const edge of orders) {
    const order = edge.node;
    const items = lineItemsFromGraphql(order.lineItems.edges);
    if (items.length === 0) continue;
    const sales = await resolveGtinSalesForLineItems(items);
    orderSales.set(order.id, sales);
    for (const sale of sales) gtinSet.add(sale.gtin);
  }

  const refreshByKey = new Map<
    string,
    Awaited<ReturnType<typeof refreshAfterShopifySale>>
  >();
  // Skip lines this cron already converged; otherwise the rolling window re-runs
  // every sale every 5 minutes (Shopify writes + main.py) until the request times out.
  const lineStates = await loadPaidLineStates(
    Array.from(orderSales.entries()).flatMap(([orderId, sales]) =>
      sales.map((sale) => ({
        orderId,
        lineItemId: sale.lineItemId,
        gtin: sale.gtin,
        variantId: sale.variantId,
        quantity: sale.quantity,
      }))
    )
  );
  let skipped = 0;

  for (const [orderId, sales] of orderSales) {
    for (const sale of sales) {
      const lineRef = {
        orderId,
        lineItemId: sale.lineItemId,
        gtin: sale.gtin,
        variantId: sale.variantId,
        quantity: sale.quantity,
      };
      if (!shouldProcessPaidLine(lineStates, lineRef)) {
        skipped += 1;
        continue;
      }

      const key = `${sale.gtin}:${sale.variantId ?? "novariant"}`;
      if (refreshByKey.has(key)) {
        await markPaidLineProcessed(lineRef, { ok: true });
        continue;
      }
      try {
        const refresh = await refreshAfterShopifySale(sale.gtin, {
          soldQty: sale.quantity,
          orderId,
          lineItemId: sale.lineItemId,
          variantId: sale.variantId,
          forceMarketPrice: true,
        });
        refreshByKey.set(key, refresh);
        const failed = refresh.warnings.length > 0 && !refresh.convergence?.changed;
        await markPaidLineProcessed(lineRef, {
          ok: !failed,
          error: failed ? refresh.warnings.join("; ") : null,
        });
      } catch (err: any) {
        refreshByKey.set(key, {
          gtin: sale.gtin,
          warnings: [err?.message ?? String(err)],
        });
        await markPaidLineProcessed(lineRef, { ok: false, error: err?.message ?? String(err) });
      }
    }
  }

  const out: OrdersPaidConvergenceResult[] = [];
  let gtins = 0;
  let changed = 0;
  let errorsCount = 0;

  for (const [orderId, salesForOrder] of orderSales) {
    const results: OrdersPaidConvergenceResult["results"] = [];
    for (const sale of salesForOrder) {
      const refresh = refreshByKey.get(`${sale.gtin}:${sale.variantId ?? "novariant"}`);
      const conv = refresh?.convergence;
      const hasError = Boolean(refresh?.warnings.length && !refresh.shopifyRefresh?.ok);
      results.push({
        gtin: sale.gtin,
        changed: Boolean(conv?.changed || refresh?.shopifyRefresh?.ok),
        changes: conv?.changes ?? [],
        error: hasError ? refresh?.warnings.join("; ") : conv?.error,
        shopifyOk: refresh?.shopifyRefresh?.ok,
        kickdbOk: refresh?.kickdbSync?.ok,
      });
      if (hasError || conv?.error) errorsCount += 1;
      if (conv?.changed || refresh?.shopifyRefresh?.ok) changed += 1;
    }
    out.push({ orderId, gtins: salesForOrder.map((s) => s.gtin), results });
    gtins += salesForOrder.length;
  }

  // Only push feeds when a sale was actually converged this run.
  if (refreshByKey.size > 0) {
    schedulePostSaleMarketplacePricePush();
  }

  return {
    scanned: orders.length,
    processed: out.length,
    gtins,
    changed,
    errors: errorsCount,
    skipped,
    orders: out,
  };
}
