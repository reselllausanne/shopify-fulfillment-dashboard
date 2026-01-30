import { NextResponse } from "next/server";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    console.log("[RECOVER] Starting recovery from Shopify metafields...");

    // Query to get all orders with metafields
    const query = `
      query GetOrdersWithMetafields($first: Int!, $after: String) {
        orders(first: $first, after: $after, query: "created_at:>2024-01-01") {
          edges {
            node {
              id
              name
              createdAt
              totalPrice
              currencyCode
              metafields(first: 10, namespace: "supplier") {
                edges {
                  node {
                    key
                    value
                    type
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

    let allOrders: any[] = [];
    let hasNextPage = true;
    let endCursor: string | null = null;
    let processedCount = 0;

    // Paginate through all orders
    while (hasNextPage && processedCount < 1000) { // Safety limit
      const variables: { first: number; after: string | null } = {
        first: 50,
        after: endCursor,
      };

      const { data, errors } = await shopifyGraphQL<{ orders: any }>(query, variables);

      if (errors) {
        console.error("[RECOVER] Shopify GraphQL errors:", errors);
        throw new Error(`Shopify API error: ${errors[0]?.message || "Unknown error"}`);
      }

      const orders = data.orders.edges.map((edge: any) => edge.node);
      allOrders.push(...orders);

      hasNextPage = data.orders.pageInfo.hasNextPage;
      endCursor = data.orders.pageInfo.endCursor;

      processedCount += orders.length;
      console.log(`[RECOVER] Fetched ${orders.length} orders (${processedCount} total)`);

      // Rate limiting
      if (hasNextPage) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    console.log(`[RECOVER] Total orders fetched: ${allOrders.length}`);

    let recovered = 0;
    let skipped = 0;
    let errors = 0;

    // Process each order
    for (const order of allOrders) {
      try {
        const metafields = order.metafields.edges.map((edge: any) => edge.node);

        // Check if order has supplier metafields
        const hasSupplierData = metafields.some((mf: any) =>
          mf.key === "margin_amount" || mf.key === "total_cost"
        );

        if (!hasSupplierData) {
          skipped++;
          continue;
        }

        // Extract data from metafields
        const getMetafieldValue = (key: string) => {
          const mf = metafields.find((m: any) => m.key === key);
          if (!mf) return null;

          if (mf.type === "number_decimal") {
            return parseFloat(mf.value);
          }
          return mf.value;
        };

        const marginAmount = getMetafieldValue("margin_amount");
        const totalCost = getMetafieldValue("total_cost");

        if (marginAmount === null || totalCost === null) {
          console.log(`[RECOVER] Missing data for ${order.name}: margin=${marginAmount}, cost=${totalCost}`);
          skipped++;
          continue;
        }

        const grossSales = parseFloat(order.totalPrice);
        const marginChf = marginAmount;
        const marginPct = grossSales > 0 ? (marginChf / grossSales) * 100 : 0;

        console.log(`[RECOVER] Processing ${order.name}: sales=${grossSales}, margin=${marginChf}, pct=${marginPct.toFixed(1)}%`);

        // Create or update OrderMetric
        await prisma.orderMetric.upsert({
          where: { shopifyOrderId: order.id },
          update: {
            grossSales,
            marginChf,
            marginPct,
            currency: order.currencyCode,
            updatedAt: new Date(),
          },
          create: {
            shopifyOrderId: order.id,
            createdAt: new Date(order.createdAt),
            grossSales,
            marginChf,
            marginPct,
            currency: order.currencyCode,
          },
        });

        recovered++;
        console.log(`[RECOVER] ✅ Recovered ${order.name}`);

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        console.error(`[RECOVER] Error processing order ${order.name}:`, error);
        errors++;
      }
    }

    console.log(`[RECOVER] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`[RECOVER] ✅ RECOVERY COMPLETE`);
    console.log(`[RECOVER] 📊 Results:`);
    console.log(`[RECOVER]   - Total orders processed: ${allOrders.length}`);
    console.log(`[RECOVER]   - Recovered: ${recovered}`);
    console.log(`[RECOVER]   - Skipped (no supplier data): ${skipped}`);
    console.log(`[RECOVER]   - Errors: ${errors}`);
    console.log(`[RECOVER] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    return NextResponse.json({
      success: true,
      message: `Recovered ${recovered} orders from Shopify metafields (${skipped} skipped, ${errors} errors)`,
      recovered,
      skipped,
      errors,
      totalProcessed: allOrders.length,
    });

  } catch (error: any) {
    console.error("[RECOVER] Error recovering from Shopify:", error);
    return NextResponse.json(
      { error: "Failed to recover from Shopify", details: error.message },
      { status: 500 }
    );
  }
}
