import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { toNumberSafe } from "@/app/utils/numbers";
import { toZonedTime } from "date-fns-tz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIMEZONE = "Europe/Zurich";

type DailyRow = {
  date: string;
  salesChf: number;
  costChf: number;
  marginChf: number;
  marginPct: number;
  returnMarginLostChf: number;
  returnedStockValueChf: number;
  adsSpendChf: number;
  netAfterAdsChf: number;
  ordersCount: number;
  lineItemsCount: number;
  missingCostCount: number;
  missingSellDateCount: number;
};

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const range = parseInt(searchParams.get("range") || "30");
    if (isNaN(range) || range < 1 || range > 365) {
      return NextResponse.json(
        { error: "Invalid range parameter. Must be between 1 and 365." },
        { status: 400 }
      );
    }

    const nowZurich = toZonedTime(new Date(), TIMEZONE);
    const startDateLocal = new Date(Date.UTC(
      nowZurich.getFullYear(),
      nowZurich.getMonth(),
      nowZurich.getDate() - (range - 1),
      0, 0, 0, 0
    ));
    const endDateLocal = new Date(Date.UTC(
      nowZurich.getFullYear(),
      nowZurich.getMonth(),
      nowZurich.getDate(),
      23, 59, 59, 999
    ));
    const yearStart = new Date(Date.UTC(nowZurich.getFullYear(), 0, 1, 0, 0, 0, 0));
    const effectiveStartDate = startDateLocal < yearStart ? yearStart : startDateLocal;

    // Source of truth: OrderMatch (shopifyCreatedAt stored in match)
    const matches = await prisma.orderMatch.findMany({
      where: {
        // Use Shopify sell date only (no fallback)
        // @ts-expect-error pending Prisma client regeneration
        shopifyCreatedAt: {
          gte: effectiveStartDate,
          lte: endDateLocal,
        },
      },
      select: {
        shopifyOrderId: true,
        shopifyOrderName: true,
        shopifyTotalPrice: true,
        manualRevenueAdjustment: true,
        supplierCost: true,
        manualCostOverride: true,
        returnReason: true,
        returnFeePercent: true,
        returnFeeAmountChf: true,
        returnedStockValueChf: true,
        createdAt: true,
        // @ts-expect-error pending Prisma client regeneration
        shopifyCreatedAt: true,
      },
    });

    const adsSpendRecords = await prisma.dailyAdSpend.findMany({
      where: { date: { gte: startDateLocal, lte: endDateLocal } },
    });

    const dailyMap = new Map<string, DailyRow>();
    const orderIdsByDay = new Map<string, Set<string>>();
    const ensureDay = (key: string) => {
      if (!dailyMap.has(key)) {
        dailyMap.set(key, {
          date: key,
          salesChf: 0,
          costChf: 0,
          marginChf: 0,
          marginPct: 0,
          returnMarginLostChf: 0,
          returnedStockValueChf: 0,
          adsSpendChf: 0,
          netAfterAdsChf: 0,
          ordersCount: 0,
          lineItemsCount: 0,
          missingCostCount: 0,
          missingSellDateCount: 0,
        });
      }
      return dailyMap.get(key)!;
    };

    for (const m of matches) {
      // @ts-expect-error pending Prisma client regeneration
      const sellDateRaw = m.shopifyCreatedAt;
      const cost = toNumberSafe(m.manualCostOverride, 0) || toNumberSafe(m.supplierCost, 0);
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
      const returnedStockValue = toNumberSafe(m.returnedStockValueChf, 0);

      if (!sellDateRaw) {
        ensureDay("missing_sell_date").missingSellDateCount += 1;
        continue;
      }

      const dateKey = sellDateRaw.toISOString().split("T")[0];
      const day = ensureDay(dateKey);
      day.lineItemsCount += 1;

      if (m.shopifyOrderId) {
        const set = orderIdsByDay.get(dateKey) ?? new Set<string>();
        set.add(m.shopifyOrderId);
        orderIdsByDay.set(dateKey, set);
        day.ordersCount = set.size;
      }

      if (!m.returnReason && (cost <= 0 || revenue <= 0)) {
        day.missingCostCount += 1;
        continue;
      }

      day.salesChf += revenue;
      day.costChf += cost;
      day.marginChf += revenue - cost;
      day.returnedStockValueChf += returnedStockValue;
      if (m.returnReason) {
        day.returnMarginLostChf += Math.max(cost - revenue, 0);
      }
    }

    for (const ads of adsSpendRecords) {
      const k = ads.date.toISOString().split("T")[0];
      ensureDay(k).adsSpendChf = toNumberSafe(ads.amountChf, 0);
    }

    const rows = Array.from(dailyMap.values())
      .filter((row) => row.date !== "missing_sell_date")
      .map((row) => {
        const marginPct = row.salesChf > 0 ? (row.marginChf / row.salesChf) * 100 : 0;
        const netAfterAds = row.marginChf - row.adsSpendChf;
        return {
          ...row,
          marginPct: Number(marginPct.toFixed(2)),
          salesChf: Number(row.salesChf.toFixed(2)),
          costChf: Number(row.costChf.toFixed(2)),
          marginChf: Number(row.marginChf.toFixed(2)),
          returnMarginLostChf: Number(row.returnMarginLostChf.toFixed(2)),
          returnedStockValueChf: Number(row.returnedStockValueChf.toFixed(2)),
          adsSpendChf: Number(row.adsSpendChf.toFixed(2)),
          netAfterAdsChf: Number(netAfterAds.toFixed(2)),
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    const totals = rows.reduce(
      (acc, r) => {
        acc.salesChf += r.salesChf;
        acc.costChf += r.costChf;
        acc.marginChf += r.marginChf;
        acc.adsSpendChf += r.adsSpendChf;
        acc.netAfterAdsChf += r.netAfterAdsChf;
        acc.returnMarginLostChf += r.returnMarginLostChf;
        acc.returnedStockValueChf += r.returnedStockValueChf;
        acc.ordersCount += r.ordersCount;
        acc.lineItemsCount += r.lineItemsCount;
        acc.missingCostCount += r.missingCostCount;
        acc.missingSellDateCount += r.missingSellDateCount;
        return acc;
      },
      {
        salesChf: 0,
        costChf: 0,
        marginChf: 0,
        adsSpendChf: 0,
        netAfterAdsChf: 0,
        returnMarginLostChf: 0,
        returnedStockValueChf: 0,
        ordersCount: 0,
        lineItemsCount: 0,
        missingCostCount: 0,
        missingSellDateCount: 0,
      }
    );

    const totalsMarginPct = totals.salesChf > 0 ? (totals.marginChf / totals.salesChf) * 100 : 0;

    return NextResponse.json({
      rows,
      totals: {
        ...totals,
        marginPct: Number(totalsMarginPct.toFixed(2)),
      },
      metadata: {
        dateMode: "sell_date",
        startDate: startDateLocal.toISOString().split("T")[0],
        endDate: endDateLocal.toISOString().split("T")[0],
        range,
      },
    });
  } catch (error: any) {
    console.error("[METRICS/DAILY] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch daily metrics", details: error.message },
      { status: 500 }
    );
  }
}
