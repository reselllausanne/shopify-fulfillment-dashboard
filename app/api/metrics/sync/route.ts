import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    // Get all matched orders with financial data
    const matches = await prisma.orderMatch.findMany({
      where: {
        supplierCost: {
          gt: 0,
        },
        marginAmount: {
          not: 0,
        },
      },
      select: {
        shopifyOrderId: true,
        shopifyTotalPrice: true,
        supplierCost: true,
        marginAmount: true,
        marginPercent: true,
        createdAt: true,
        shopifyCurrencyCode: true,
      },
    });

    if (matches.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No order matches with financial data found",
        synced: 0,
      });
    }

    let synced = 0;
    let skipped = 0;

    // Process each match
    for (const match of matches) {
      try {
        // Check if metric already exists
        const existing = await prisma.orderMetric.findUnique({
          where: {
            shopifyOrderId: match.shopifyOrderId,
          },
        });

        if (existing) {
          // Update existing metric
          await prisma.orderMetric.update({
            where: {
              shopifyOrderId: match.shopifyOrderId,
            },
            data: {
              grossSales: match.shopifyTotalPrice,
              marginChf: match.marginAmount,
              marginPct: match.marginPercent,
              currency: match.shopifyCurrencyCode,
              updatedAt: new Date(),
            },
          });
          skipped++;
        } else {
          // Create new metric
          await prisma.orderMetric.create({
            data: {
              shopifyOrderId: match.shopifyOrderId,
              createdAt: match.createdAt,
              grossSales: match.shopifyTotalPrice,
              marginChf: match.marginAmount,
              marginPct: match.marginPercent,
              currency: match.shopifyCurrencyCode,
            },
          });
          synced++;
        }
      } catch (error) {
        console.error(`Error syncing metric for order ${match.shopifyOrderId}:`, error);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Synced ${synced} new metrics, updated ${skipped} existing`,
      synced,
      updated: skipped,
      total: matches.length,
    });

  } catch (error) {
    console.error("Error syncing metrics:", error);
    return NextResponse.json(
      { error: "Failed to sync metrics" },
      { status: 500 }
    );
  }
}
