import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/sync/shopify-orders
 * 
 * Syncs ALL Shopify orders to ShopifyOrder table
 * This is the source of truth for "booked sales"
 * Independent from matching logic
 */

const QUERY = /* GraphQL */ `
query OrdersForSync($first: Int!, $query: String!) {
  orders(first: $first, query: $query, sortKey: CREATED_AT, reverse: true) {
    edges {
      node {
        id
        name
        createdAt
        cancelledAt
        displayFinancialStatus
        displayFulfillmentStatus
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
    
    // Ensure it's exactly Jan 1st at 00:00:00 UTC
    startDate.setUTCHours(0, 0, 0, 0);
    const iso = startDate.toISOString();
    
    console.log(`[SHOPIFY-SYNC] Starting sync of orders from ${iso} (start of year UTC)...`);
    
    // Fetch ALL orders (fulfilled or not, paid or not) from start of year
    const search = `created_at:>=${iso}`;
    
    const { data, errors } = await shopifyGraphQL<{
      orders: { edges: { node: any }[] };
    }>(QUERY, { first: 60, query: search }); // Changed to 60 max as requested
    
    if (errors?.length) {
      console.error("[SHOPIFY-SYNC] GraphQL errors:", errors);
      return NextResponse.json(
        { error: "Shopify GraphQL errors", details: errors },
        { status: 500 }
      );
    }
    
    const orders = data?.orders?.edges ?? [];
    console.log(`[SHOPIFY-SYNC] Found ${orders.length} Shopify orders from API`);
    
    let synced = 0;
    let skipped = 0;
    let errors_count = 0;
    
    // Filter: Only save orders from Jan 1st onwards (double-check)
    const jan1UTC = new Date(Date.UTC(now.getUTCFullYear(), 0, 1, 0, 0, 0, 0));
    
    for (const edge of orders) {
      const order = edge.node;
      
      try {
        // CRITICAL: Filter out orders before Jan 1st
        const orderDate = new Date(order.createdAt);
        if (orderDate < jan1UTC) {
          skipped++;
          console.log(`[SHOPIFY-SYNC] Skipping order ${order.name} from ${orderDate.toISOString().split('T')[0]} (before Jan 1)`);
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
    
    console.log(`[SHOPIFY-SYNC] Complete: ${synced} synced, ${skipped} skipped (before Jan 1), ${errors_count} errors`);
    
    return NextResponse.json({
      success: true,
      synced,
      skipped,
      errors: errors_count,
      message: `Synced ${synced} Shopify orders from Jan 1st (${skipped} skipped - before Jan 1)`,
    }, { status: 200 });
    
  } catch (error: any) {
    console.error("[SHOPIFY-SYNC] Error:", error);
    return NextResponse.json(
      { error: "Failed to sync Shopify orders", details: error.message },
      { status: 500 }
    );
  }
}

