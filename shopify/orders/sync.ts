import { prisma } from "@/app/lib/prisma";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { applyInventoryOrderLine } from "@/inventory/applyOrderLines";
import { upsertPackageProtectionMatches } from "@/shopify/protection/upsertPackageProtectionMatches";

type ShopifyOrdersSyncData = {
  orders: {
    edges: Array<{
      cursor: string;
      node: {
        id: string;
        name: string;
        createdAt: string;
        cancelledAt: string | null;
        displayFinancialStatus: string;
        displayFulfillmentStatus: string;
        paymentGatewayNames: string[];
        currentTotalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
        totalRefundedSet: { shopMoney: { amount: string; currencyCode: string } } | null;
        lineItems: {
          edges: Array<{
            node: {
              id: string;
              title: string;
              sku: string | null;
              variantTitle: string | null;
              quantity: number;
              discountedTotalSet?: { shopMoney: { amount: string; currencyCode: string } } | null;
            };
          }>;
        };
      };
    }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

type ShopifyGqlResult<T> = { data: T; errors?: { message: string }[] };

const QUERY = /* GraphQL */ `
query OrdersForSync($first: Int!, $query: String!, $after: String) {
  orders(first: $first, query: $query, after: $after, sortKey: CREATED_AT, reverse: true) {
    edges {
      cursor
      node {
        id
        name
        createdAt
        cancelledAt
        displayFinancialStatus
        displayFulfillmentStatus
        paymentGatewayNames
        currentTotalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        totalRefundedSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        lineItems(first: 250) {
          edges {
            node {
              id
              title
              sku
              variantTitle
              quantity
              discountedTotalSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
            }
          }
        }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
`;

export type ShopifyOrderSyncResult = {
  pages: number;
  fetched: number;
  synced: number;
  skipped: number;
  errors: number;
  startDateIso: string;
  packageProtection: {
    considered: number;
    upserted: number;
  };
  inventory: {
    applied: number;
    alreadyProcessed: number;
    unresolved: number;
    invalid: number;
  };
};

export async function runShopifyOrdersSync(options?: {
  startDate?: Date;
  pageSize?: number;
  /** Cap pages so scheduled ticks cannot hang on full-year pagination. */
  maxPages?: number;
}): Promise<ShopifyOrderSyncResult> {
  const now = new Date();
  // Default: last 14d (not YTD). Full-year walks timed out ops tick at 600s and killed the cron.
  const defaultStart = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  defaultStart.setUTCHours(0, 0, 0, 0);
  const startDate = options?.startDate ? new Date(options.startDate) : defaultStart;
  startDate.setUTCHours(0, 0, 0, 0);
  const iso = startDate.toISOString();
  const search = `created_at:>=${iso}`;
  const pageSize = Math.min(Math.max(Number(options?.pageSize ?? 60), 1), 250);
  const maxPages = Math.min(Math.max(Number(options?.maxPages ?? 30), 1), 500);

  let hasNextPage = true;
  let cursor: string | null = null;
  let pages = 0;
  let fetched = 0;
  let synced = 0;
  let skipped = 0;
  let errorsCount = 0;
  const inventory = {
    applied: 0,
    alreadyProcessed: 0,
    unresolved: 0,
    invalid: 0,
  };
  const packageProtection = {
    considered: 0,
    upserted: 0,
  };

  while (hasNextPage && pages < maxPages) {
    pages += 1;
    const result: ShopifyGqlResult<ShopifyOrdersSyncData> =
      await shopifyGraphQL<ShopifyOrdersSyncData>(QUERY, {
        first: pageSize,
        query: search,
        after: cursor,
      });
    const { data, errors } = result;
    if (errors?.length) {
      throw new Error(errors.map((error) => error.message).join("; "));
    }

    const orders = data?.orders?.edges ?? [];
    fetched += orders.length;

    for (const edge of orders) {
      const order = edge.node;
      try {
        const orderDate = new Date(order.createdAt);
        if (orderDate < startDate) {
          skipped += 1;
          continue;
        }

        const totalPrice = Number.parseFloat(order.currentTotalPriceSet.shopMoney.amount);
        const currencyCode = order.currentTotalPriceSet.shopMoney.currencyCode;
        const refundedAmount = order.totalRefundedSet?.shopMoney?.amount
          ? Number.parseFloat(order.totalRefundedSet.shopMoney.amount)
          : 0;
        const totalSalesChf = currencyCode === "CHF" ? totalPrice : totalPrice;
        const refundedAmountChf = currencyCode === "CHF" ? refundedAmount : refundedAmount;
        const netSalesChf = totalSalesChf - refundedAmountChf;
        const cancelledAt = order.cancelledAt ? new Date(order.cancelledAt) : null;

        await prisma.shopifyOrder.upsert({
          where: {
            shopifyOrderId: order.id,
          },
          update: {
            totalSalesChf,
            currencyCode,
            financialStatus: order.displayFinancialStatus,
            paymentGatewayNames: order.paymentGatewayNames ?? [],
            cancelledAt,
            refundedAmountChf,
            netSalesChf,
            syncedAt: new Date(),
          },
          create: {
            shopifyOrderId: order.id,
            orderName: order.name,
            createdAt: new Date(order.createdAt),
            totalSalesChf,
            currencyCode,
            financialStatus: order.displayFinancialStatus,
            paymentGatewayNames: order.paymentGatewayNames ?? [],
            cancelledAt,
            refundedAmountChf,
            netSalesChf,
          },
        });
        synced += 1;

        const lineEdges = order?.lineItems?.edges ?? [];
        const protectionLines = [];
        for (const lineEdge of lineEdges) {
          const line = lineEdge?.node;
          if (!line?.id) continue;
          const lineTotal = Number.parseFloat(line.discountedTotalSet?.shopMoney?.amount ?? "0");
          const lineCurrency = line.discountedTotalSet?.shopMoney?.currencyCode || currencyCode;
          protectionLines.push({
            shopifyOrderId: order.id,
            shopifyOrderName: order.name,
            shopifyLineItemId: line.id,
            shopifyProductTitle: line.title || "Package protection",
            shopifySku: line.sku ?? null,
            shopifyTotalPrice: Number.isFinite(lineTotal) ? lineTotal : 0,
            shopifyCurrencyCode: lineCurrency,
            shopifyCreatedAt: orderDate,
          });
          const inventoryResult = await applyInventoryOrderLine({
            channel: "SHOPIFY",
            externalOrderId: order.id,
            externalLineId: line.id,
            quantity: Number(line.quantity ?? 1),
            providerKey: line.sku ?? null,
            sku: line.sku ?? null,
            occurredAt: orderDate,
            payloadJson: {
              source: "shopify-orders-sync",
              orderName: order.name,
              title: line.title,
              variantTitle: line.variantTitle,
            },
          });
          if (inventoryResult.applied) inventory.applied += 1;
          else if (inventoryResult.reason === "already_processed") inventory.alreadyProcessed += 1;
          else if (inventoryResult.reason === "unresolved_variant") inventory.unresolved += 1;
          else inventory.invalid += 1;
        }
        const pp = await upsertPackageProtectionMatches(protectionLines);
        packageProtection.considered += pp.considered;
        packageProtection.upserted += pp.upserted;
      } catch (error) {
        errorsCount += 1;
        console.error("[SHOPIFY-SYNC] Failed order sync", {
          orderName: order?.name,
          error,
        });
      }
    }

    hasNextPage = data?.orders?.pageInfo?.hasNextPage ?? false;
    cursor = data?.orders?.pageInfo?.endCursor ?? null;
  }

  return {
    pages,
    fetched,
    synced,
    skipped,
    errors: errorsCount,
    startDateIso: iso,
    packageProtection,
    inventory,
  };
}
