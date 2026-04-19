import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
      };
    }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

type ShopifyGqlResult<T> = { data: T; errors?: { message: string }[] };

/**
 * POST /api/sync/shopify-orders
 * 
 * Syncs ALL Shopify orders to ShopifyOrder table
 * This is the source of truth for "booked sales"
 * Independent from matching logic
 */

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
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
`;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    
    // Calculate start of year in UTC: 2026-01-01T00:00:00.000Z
    const now = new Date();
    const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1, 0, 0, 0, 0)); // Jan 1st, 00:00:00 UTC
    
    const startDate = body?.startDate 
      ? new Date(body.startDate)
      : yearStart;
    
    // Ensure it's exactly start of day UTC
    startDate.setUTCHours(0, 0, 0, 0);
    const iso = startDate.toISOString();
    
    console.log(`[SHOPIFY-SYNC] Starting sync of orders from ${iso} (start of year UTC)...`);
    
    // Fetch ALL orders (fulfilled or not, paid or not) from start of year
    const search = `created_at:>=${iso}`;
    
    const PAGE_SIZE = 60;
    let hasNextPage = true;
    let cursor: string | null = null;
    let pages = 0;
    let fetched = 0;

    let synced = 0;
    let skipped = 0;
    let errors_count = 0;
    while (hasNextPage) {
      pages += 1;
      const result: ShopifyGqlResult<ShopifyOrdersSyncData> =
        await shopifyGraphQL<ShopifyOrdersSyncData>(QUERY, {
          first: PAGE_SIZE,
          query: search,
          after: cursor,
        });
      const { data, errors } = result;

      if (errors?.length) {
        console.error("[SHOPIFY-SYNC] GraphQL errors:", errors);
        return NextResponse.json(
          { error: "Shopify GraphQL errors", details: errors },
          { status: 500 }
        );
      }

      const orders = data?.orders?.edges ?? [];
      fetched += orders.length;
      console.log(`[SHOPIFY-SYNC] Page ${pages}: ${orders.length} orders`);

      for (const edge of orders) {
        const order = edge.node;

        try {
          // Filter out orders before the requested start date
          const orderDate = new Date(order.createdAt);
          if (orderDate < startDate) {
            skipped++;
            continue;
          }

          const totalPrice = parseFloat(order.currentTotalPriceSet.shopMoney.amount);
          const currencyCode = order.currentTotalPriceSet.shopMoney.currencyCode;

          // Parse refunded amount
          const refundedAmount = order.totalRefundedSet?.shopMoney?.amount
            ? parseFloat(order.totalRefundedSet.shopMoney.amount)
            : 0;

          // Convert to CHF if needed (simplified - you may want exchange rates)
          const totalSalesChf = currencyCode === "CHF" ? totalPrice : totalPrice;
          const refundedAmountChf = currencyCode === "CHF" ? refundedAmount : refundedAmount;

          // Calculate net sales (gross - refunded)
          const netSalesChf = totalSalesChf - refundedAmountChf;

          // Parse cancelledAt
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

          synced++;
        } catch (error) {
          console.error(`[SHOPIFY-SYNC] Error syncing order ${order.name}:`, error);
          errors_count++;
        }
      }

      hasNextPage = data?.orders?.pageInfo?.hasNextPage ?? false;
      cursor = data?.orders?.pageInfo?.endCursor ?? null;
      if (!hasNextPage) break;
    }
    
    console.log(`[SHOPIFY-SYNC] Complete: ${synced} synced, ${skipped} skipped, ${errors_count} errors`);
    
    return NextResponse.json({
      success: true,
      pages,
      fetched,
      synced,
      skipped,
      errors: errors_count,
      message: `Synced ${synced} Shopify orders from ${iso} (${skipped} skipped)`,
    }, { status: 200 });
    
  } catch (error: any) {
    console.error("[SHOPIFY-SYNC] Error:", error);
    return NextResponse.json(
      { error: "Failed to sync Shopify orders", details: error.message },
      { status: 500 }
    );
  }
}

