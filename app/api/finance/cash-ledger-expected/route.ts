import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { toNumberSafe } from "@/app/utils/numbers";
import {
  buildDateRange,
  CASHFLOW_TIMEZONE,
  endOfTodayZurich,
  toDateKey,
} from "@/app/lib/cashflow";
import { FinanceDirection } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChannelKey = "SHOPIFY" | "GALAXUS" | "DECATHLON";

function parseDateParam(value: string | null, endOfDay: boolean) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [yearRaw, monthRaw, dayRaw] = value.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!year || !month || !day) return null;
  return endOfDay
    ? new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999))
    : new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const range = Number(searchParams.get("range") || 30);
    const channelsParam = searchParams.getAll("channels");
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");

    const endDate = parseDateParam(toParam, true) ?? endOfTodayZurich();
    const startDate =
      parseDateParam(fromParam, false) ??
      new Date(endDate.getTime() - (range - 1) * 24 * 60 * 60 * 1000);

    const channelFilter = new Set<ChannelKey>(
      channelsParam.length
        ? (channelsParam.map((c) => c.toUpperCase()) as ChannelKey[])
        : ["SHOPIFY", "GALAXUS", "DECATHLON"]
    );

    const config = await prisma.cashFlowConfig.findFirst({
      orderBy: { updatedAt: "desc" },
    });
    const startingBalance = toNumberSafe(config?.initialBalanceChf, 0);

    const channelList = Array.from(channelFilter);

    const events = await prisma.expectedCashEvent.findMany({
      where: {
        expectedDate: { gte: startDate, lte: endDate },
        status: { notIn: ["VOID", "SUPERSEDED"] },
        OR: [{ channel: null }, { channel: { in: channelList } }],
      },
      select: {
        expectedDate: true,
        direction: true,
        amount: true,
        confidence: true,
        manualFinanceEventId: true,
        category: true,
      },
    });

    const cashInByDate = new Map<string, number>();
    const cashOutByDate = new Map<string, number>();
    let lowConfidenceCount = 0;
    let manualLinkedCount = 0;

    for (const ev of events) {
      if (ev.confidence === "LOW") lowConfidenceCount += 1;
      if (ev.manualFinanceEventId) manualLinkedCount += 1;

      const key = toDateKey(ev.expectedDate);
      const amt = Number(toNumberSafe(ev.amount, 0).toFixed(2));
      if (amt <= 0) continue;
      if (ev.direction === FinanceDirection.IN) {
        cashInByDate.set(key, (cashInByDate.get(key) || 0) + amt);
      } else {
        cashOutByDate.set(key, (cashOutByDate.get(key) || 0) + amt);
      }
    }

    const ledgerDates = buildDateRange(startDate, endDate);
    const rows: Array<{
      date: string;
      openingBalance: number;
      cashIn: number;
      cashOut: number;
      closingBalance: number;
    }> = [];

    let balance = startingBalance;
    let minBalance = balance;
    let minBalanceDate = toDateKey(startDate);
    let closingAtEnd = balance;

    for (const day of ledgerDates) {
      const dateKey = toDateKey(day);
      const cashIn = Number((cashInByDate.get(dateKey) || 0).toFixed(2));
      const cashOut = Number((cashOutByDate.get(dateKey) || 0).toFixed(2));
      const openingBalance = Number(balance.toFixed(2));
      const closingBalance = Number((openingBalance + cashIn - cashOut).toFixed(2));
      rows.push({ date: dateKey, openingBalance, cashIn, cashOut, closingBalance });
      if (closingBalance < minBalance) {
        minBalance = closingBalance;
        minBalanceDate = dateKey;
      }
      balance = closingBalance;
      if (day <= endDate) closingAtEnd = closingBalance;
    }

    return NextResponse.json({
      rows,
      kpis: {
        minBalance: Number(minBalance.toFixed(2)),
        minBalanceDate,
        currentBalance: Number(closingAtEnd.toFixed(2)),
        projectedBalance: Number(closingAtEnd.toFixed(2)),
        startingBalanceUsed: Number(startingBalance.toFixed(2)),
      },
      metadata: {
        sourceLayer: "ExpectedCashEvent",
        startDate: toDateKey(startDate),
        endDate: toDateKey(endDate),
        projectionEnd: toDateKey(endDate),
        timezone: CASHFLOW_TIMEZONE,
        channels: channelList,
        eventCount: events.length,
        lowConfidenceEventCount: lowConfidenceCount,
        manualLinkedEventCount: manualLinkedCount,
        isEmpty: events.length === 0,
      },
    });
  } catch (error: any) {
    console.error("[FINANCE][CASH_LEDGER_EXPECTED] Error:", error);
    return NextResponse.json(
      { error: "Failed to build expected cash ledger", details: error.message },
      { status: 500 }
    );
  }
}
