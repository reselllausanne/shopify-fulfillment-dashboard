import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { toNumberSafe } from "@/app/utils/numbers";
import { resolveOrderMatchCost } from "@/app/utils/matching";
import { shopifySellDateUtcWindow } from "@/app/utils/shopifySellDate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const dateStr = searchParams.get("date");
    const window = shopifySellDateUtcWindow(dateStr || "");

    if (!window) {
      return NextResponse.json(
        { error: "Missing or invalid date. Use YYYY-MM-DD" },
        { status: 400 }
      );
    }

    const { start, end } = window;

    const matches = await prisma.orderMatch.findMany({
      where: {
        shopifyCreatedAt: {
          gte: start,
          lte: end,
        },
      },
      orderBy: {
        shopifyCreatedAt: "asc",
      },
      select: {
        shopifyOrderId: true,
        shopifyOrderName: true,
        shopifyProductTitle: true,
        shopifySku: true,
        shopifySizeEU: true,
        shopifyTotalPrice: true,
        manualRevenueAdjustment: true,
        supplierCost: true,
        manualCostOverride: true,
        returnReason: true,
        returnFeePercent: true,
        returnFeeAmountChf: true,
        shopifyCreatedAt: true,
        stockxOrderNumber: true,
        stockxStatus: true,
        supplierSource: true,
      },
    });

    const rows = matches.map((m: (typeof matches)[number]) => {
      const baseRevenue =
        toNumberSafe(m.shopifyTotalPrice, 0) + toNumberSafe(m.manualRevenueAdjustment, 0);
      const returnFeePercent = toNumberSafe(m.returnFeePercent, 0);
      const returnFeeAmount = m.returnReason
        ? toNumberSafe(
            m.returnFeeAmountChf,
            returnFeePercent > 0 ? (toNumberSafe(m.shopifyTotalPrice, 0) * returnFeePercent) / 100 : 0
          )
        : 0;
      const revenue = m.returnReason ? returnFeeAmount : baseRevenue;
      const { cost } = resolveOrderMatchCost(m);
      const margin = revenue - cost;

      return {
        shopifyOrderId: m.shopifyOrderId,
        shopifyOrderName: m.shopifyOrderName,
        shopifyProductTitle: m.shopifyProductTitle,
        shopifySku: m.shopifySku,
        shopifySizeEU: m.shopifySizeEU,
        shopifyCreatedAt: m.shopifyCreatedAt,
        stockxOrderNumber: m.stockxOrderNumber,
        supplierSource: m.supplierSource,
        returnReason: m.returnReason,
        revenue,
        cost,
        margin,
      };
    });

    return NextResponse.json({ date: dateStr, rows });
  } catch (error: any) {
    console.error("[METRICS/DAILY-DETAILS] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch daily details", details: error?.message || String(error) },
      { status: 500 }
    );
  }
}

