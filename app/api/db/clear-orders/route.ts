import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/db/clear-orders
 * 
 * Clears all Shopify orders and order matches from the database.
 * This allows for a fresh start when re-syncing from a specific date.
 * 
 * KEEPS:
 * - Expenses (PersonalExpense)
 * - Ads Spend (DailyAdSpend)
 * - Variable Costs (MonthlyVariableCosts)
 * - StockX tokens
 * - Other configuration data
 * 
 * DELETES:
 * - All ShopifyOrder records
 * - All OrderMatch records
 */
export async function POST(req: Request) {
  try {
    // Count records before deletion
    const shopifyOrderCount = await prisma.shopifyOrder.count();
    const orderMatchCount = await prisma.orderMatch.count();

    if (shopifyOrderCount === 0 && orderMatchCount === 0) {
      return NextResponse.json({
        success: true,
        message: "Database is already empty",
        deleted: {
          shopifyOrders: 0,
          orderMatches: 0,
        },
      }, { status: 200 });
    }

    console.log(`[CLEAR-ORDERS] Starting deletion: ${shopifyOrderCount} Shopify orders, ${orderMatchCount} matches`);

    // Delete in correct order (matches first, then orders)
    const deletedMatches = await prisma.orderMatch.deleteMany({});
    const deletedOrders = await prisma.shopifyOrder.deleteMany({});

    console.log(`[CLEAR-ORDERS] Complete: ${deletedMatches.count} matches, ${deletedOrders.count} orders deleted`);

    return NextResponse.json({
      success: true,
      message: `Cleared ${deletedOrders.count} Shopify orders and ${deletedMatches.count} order matches`,
      deleted: {
        shopifyOrders: deletedOrders.count,
        orderMatches: deletedMatches.count,
      },
    }, { status: 200 });

  } catch (error: any) {
    console.error("[CLEAR-ORDERS] Error:", error);
    return NextResponse.json(
      { error: "Failed to clear orders", details: error.message },
      { status: 500 }
    );
  }
}

