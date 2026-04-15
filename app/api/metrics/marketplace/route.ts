import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { toNumberSafe } from "@/app/utils/numbers";
import { decathlonGrossLineAmount } from "@/decathlon/orders/margin";
import { galaxusLineNetRevenueChf } from "@/galaxus/orders/margin";
import { toZonedTime } from "date-fns-tz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const TIMEZONE = "Europe/Zurich";

type MarketplaceTotals = {
  revenueChf: number;
  marginChf: number;
  orderCount: number;
  lineCount: number;
  unitCount: number;
};

type DailyEntry = {
  decathlonMarginChf: number;
  galaxusMarginChf: number;
  decathlonLineCount: number;
  galaxusLineCount: number;
  decathlonOrderCount: number;
  galaxusOrderCount: number;
};

const emptyTotals = (): MarketplaceTotals => ({
  revenueChf: 0,
  marginChf: 0,
  orderCount: 0,
  lineCount: 0,
  unitCount: 0,
});

const round2 = (value: number) => Number(value.toFixed(2));

const isStockxMatchLinked = (match: {
  stockxOrderNumber?: string | null;
  stockxOrderId?: string | null;
  stockxChainId?: string | null;
}) => {
  if (!match) return false;
  const onum = String(match.stockxOrderNumber ?? "").trim();
  const oid = String(match.stockxOrderId ?? "").trim();
  const chain = String(match.stockxChainId ?? "").trim();
  return onum.length > 0 || oid.length > 0 || chain.length > 0;
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get("days") || "30");

    if (isNaN(days) || days < 1 || days > 365) {
      return NextResponse.json(
        { error: "Invalid days parameter. Must be between 1 and 365." },
        { status: 400 }
      );
    }

    const nowZurich = toZonedTime(new Date(), TIMEZONE);
    const startDateLocal = new Date(
      Date.UTC(
        nowZurich.getFullYear(),
        nowZurich.getMonth(),
        nowZurich.getDate() - (days - 1),
        0,
        0,
        0,
        0
      )
    );
    const endDateLocal = new Date(
      Date.UTC(
        nowZurich.getFullYear(),
        nowZurich.getMonth(),
        nowZurich.getDate(),
        23,
        59,
        59,
        999
      )
    );

    const [decathlonLines, galaxusLines] = await Promise.all([
      prisma.decathlonOrderLine.findMany({
        where: {
          order: {
            orderDate: {
              gte: startDateLocal,
              lte: endDateLocal,
            },
          },
        },
        select: {
          id: true,
          orderId: true,
          quantity: true,
          lineTotal: true,
          unitPrice: true,
          order: { select: { orderDate: true } },
          stockxMatch: {
            select: {
              stockxAmount: true,
              stockxOrderNumber: true,
              stockxOrderId: true,
              stockxChainId: true,
            },
          },
        },
      }),
      prisma.galaxusOrderLine.findMany({
        where: {
          order: {
            orderDate: {
              gte: startDateLocal,
              lte: endDateLocal,
            },
          },
        },
        select: {
          id: true,
          orderId: true,
          quantity: true,
          lineNetAmount: true,
          priceLineAmount: true,
          order: { select: { orderDate: true } },
          stockxMatches: {
            orderBy: { updatedAt: "desc" },
            select: {
              stockxAmount: true,
              stockxOrderNumber: true,
              stockxOrderId: true,
              stockxChainId: true,
            },
          },
        },
      }),
    ]);

    const totals = {
      decathlon: emptyTotals(),
      galaxus: emptyTotals(),
    };
    const decathlonOrderIds = new Set<string>();
    const galaxusOrderIds = new Set<string>();
    const decathlonOrdersByDay = new Map<string, Set<string>>();
    const galaxusOrdersByDay = new Map<string, Set<string>>();
    const dailyMap = new Map<string, DailyEntry>();

    const ensureDay = (key: string) => {
      if (!dailyMap.has(key)) {
        dailyMap.set(key, {
          decathlonMarginChf: 0,
          galaxusMarginChf: 0,
          decathlonLineCount: 0,
          galaxusLineCount: 0,
          decathlonOrderCount: 0,
          galaxusOrderCount: 0,
        });
      }
      return dailyMap.get(key)!;
    };

    const bumpOrderCount = (map: Map<string, Set<string>>, dateKey: string, orderId: string) => {
      const set = map.get(dateKey) ?? new Set<string>();
      set.add(orderId);
      map.set(dateKey, set);
      return set.size;
    };

    for (const line of decathlonLines) {
      const match = line.stockxMatch;
      if (!match || !isStockxMatchLinked(match)) continue;
      const cost = toNumberSafe(match.stockxAmount, 0);
      if (cost <= 0) continue;
      const grossLine = decathlonGrossLineAmount({
        lineTotal: line.lineTotal,
        unitPrice: line.unitPrice,
        quantity: line.quantity,
      });
      if (grossLine == null) continue;
      const revenue = grossLine;
      const margin = revenue - cost;
      const orderDate = line.order?.orderDate;
      if (!orderDate) continue;

      const dateKey = orderDate.toISOString().split("T")[0];
      const day = ensureDay(dateKey);
      day.decathlonMarginChf += margin;
      day.decathlonLineCount += 1;
      day.decathlonOrderCount = bumpOrderCount(decathlonOrdersByDay, dateKey, line.orderId);

      totals.decathlon.revenueChf += revenue;
      totals.decathlon.marginChf += margin;
      totals.decathlon.lineCount += 1;
      totals.decathlon.unitCount += toNumberSafe(line.quantity, 1);
      decathlonOrderIds.add(line.orderId);
    }

    for (const line of galaxusLines) {
      const match = (line.stockxMatches || []).find(
        (m) => isStockxMatchLinked(m) && toNumberSafe(m.stockxAmount, 0) > 0
      );
      if (!match) continue;
      const cost = toNumberSafe(match.stockxAmount, 0);
      const revenue = galaxusLineNetRevenueChf({
        lineNetAmount: line.lineNetAmount,
        priceLineAmount: line.priceLineAmount,
      });
      if (revenue == null) continue;
      const margin = revenue - cost;
      const orderDate = line.order?.orderDate;
      if (!orderDate) continue;

      const dateKey = orderDate.toISOString().split("T")[0];
      const day = ensureDay(dateKey);
      day.galaxusMarginChf += margin;
      day.galaxusLineCount += 1;
      day.galaxusOrderCount = bumpOrderCount(galaxusOrdersByDay, dateKey, line.orderId);

      totals.galaxus.revenueChf += revenue;
      totals.galaxus.marginChf += margin;
      totals.galaxus.lineCount += 1;
      totals.galaxus.unitCount += toNumberSafe(line.quantity, 1);
      galaxusOrderIds.add(line.orderId);
    }

    totals.decathlon.orderCount = decathlonOrderIds.size;
    totals.galaxus.orderCount = galaxusOrderIds.size;

    const data = Array.from(dailyMap.entries())
      .map(([date, day]) => ({
        date,
        decathlonMarginChf: round2(day.decathlonMarginChf),
        galaxusMarginChf: round2(day.galaxusMarginChf),
        totalMarginChf: round2(day.decathlonMarginChf + day.galaxusMarginChf),
        decathlonLineCount: day.decathlonLineCount,
        galaxusLineCount: day.galaxusLineCount,
        decathlonOrderCount: day.decathlonOrderCount,
        galaxusOrderCount: day.galaxusOrderCount,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const combined = {
      revenueChf: round2(totals.decathlon.revenueChf + totals.galaxus.revenueChf),
      marginChf: round2(totals.decathlon.marginChf + totals.galaxus.marginChf),
      orderCount: totals.decathlon.orderCount + totals.galaxus.orderCount,
      lineCount: totals.decathlon.lineCount + totals.galaxus.lineCount,
      unitCount: totals.decathlon.unitCount + totals.galaxus.unitCount,
    };

    return NextResponse.json({
      data,
      totals: {
        decathlon: {
          ...totals.decathlon,
          revenueChf: round2(totals.decathlon.revenueChf),
          marginChf: round2(totals.decathlon.marginChf),
        },
        galaxus: {
          ...totals.galaxus,
          revenueChf: round2(totals.galaxus.revenueChf),
          marginChf: round2(totals.galaxus.marginChf),
        },
        combined,
      },
      period: {
        startDate: startDateLocal.toISOString().split("T")[0],
        endDate: endDateLocal.toISOString().split("T")[0],
        days,
      },
    });
  } catch (error: any) {
    console.error("[METRICS][MARKETPLACE] Error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to fetch marketplace metrics", details: errorMessage },
      { status: 500 }
    );
  }
}
