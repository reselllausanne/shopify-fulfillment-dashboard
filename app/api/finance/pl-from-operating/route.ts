import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { toNumberSafe } from "@/app/utils/numbers";
import { OperatingDirection, OperatingEventType } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function monthKey(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const year = Number(searchParams.get("year") || new Date().getUTCFullYear());
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");

    let start: Date;
    let end: Date;
    if (fromParam && toParam) {
      start = new Date(fromParam);
      end = new Date(toParam);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return NextResponse.json({ error: "Invalid from/to" }, { status: 400 });
      }
    } else {
      start = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
      end = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));
    }

    const events = await prisma.operatingEvent.findMany({
      where: {
        eventDate: { gte: start, lte: end },
        status: { notIn: ["VOID", "SUPERSEDED"] },
      },
      select: {
        eventDate: true,
        eventType: true,
        direction: true,
        amount: true,
        isManual: true,
        isEstimated: true,
        channel: true,
      },
    });

    type MonthAgg = {
      revenue: number;
      refunds: number;
      cogs: number;
      ads: number;
      shipping: number;
      subscriptions: number;
      ownerDraw: number;
      insurance: number;
      fuel: number;
      tax: number;
      otherOut: number;
      otherIn: number;
      manualOut: number;
      manualIn: number;
      estimatedOut: number;
      estimatedIn: number;
    };

    const empty = (): MonthAgg => ({
      revenue: 0,
      refunds: 0,
      cogs: 0,
      ads: 0,
      shipping: 0,
      subscriptions: 0,
      ownerDraw: 0,
      insurance: 0,
      fuel: 0,
      tax: 0,
      otherOut: 0,
      otherIn: 0,
      manualOut: 0,
      manualIn: 0,
      estimatedOut: 0,
      estimatedIn: 0,
    });

    const byMonth = new Map<string, MonthAgg>();
    const totals: MonthAgg = empty();

    const add = (m: MonthAgg, field: keyof MonthAgg, v: number) => {
      (m as any)[field] += v;
    };

    for (const ev of events) {
      const mk = monthKey(ev.eventDate);
      if (!byMonth.has(mk)) byMonth.set(mk, empty());
      const row = byMonth.get(mk)!;
      const amt = toNumberSafe(ev.amount, 0);
      if (amt <= 0) continue;

      const isManual = ev.isManual;
      const isEst = ev.isEstimated;

      if (ev.eventType === OperatingEventType.SALE && ev.direction === OperatingDirection.IN) {
        add(row, "revenue", amt);
        add(totals, "revenue", amt);
        if (isManual) {
          add(row, "manualIn", amt);
          add(totals, "manualIn", amt);
        }
        if (isEst) {
          add(row, "estimatedIn", amt);
          add(totals, "estimatedIn", amt);
        }
        continue;
      }
      if (ev.eventType === OperatingEventType.REFUND) {
        add(row, "refunds", amt);
        add(totals, "refunds", amt);
        continue;
      }
      if (ev.eventType === OperatingEventType.COGS) {
        add(row, "cogs", amt);
        add(totals, "cogs", amt);
        if (isEst) {
          add(row, "estimatedOut", amt);
          add(totals, "estimatedOut", amt);
        }
        continue;
      }
      if (ev.eventType === OperatingEventType.AD_SPEND) {
        add(row, "ads", amt);
        add(totals, "ads", amt);
        continue;
      }
      if (ev.eventType === OperatingEventType.SHIPPING_COST) {
        add(row, "shipping", amt);
        add(totals, "shipping", amt);
        continue;
      }
      if (ev.eventType === OperatingEventType.SUBSCRIPTION_COST) {
        add(row, "subscriptions", amt);
        add(totals, "subscriptions", amt);
        continue;
      }
      if (ev.eventType === OperatingEventType.OWNER_DRAW) {
        add(row, "ownerDraw", amt);
        add(totals, "ownerDraw", amt);
        continue;
      }
      if (ev.eventType === OperatingEventType.INSURANCE) {
        add(row, "insurance", amt);
        add(totals, "insurance", amt);
        continue;
      }
      if (ev.eventType === OperatingEventType.FUEL) {
        add(row, "fuel", amt);
        add(totals, "fuel", amt);
        continue;
      }
      if (ev.eventType === OperatingEventType.TAX || ev.eventType === OperatingEventType.VAT) {
        add(row, "tax", amt);
        add(totals, "tax", amt);
        continue;
      }
      if (ev.direction === OperatingDirection.OUT) {
        add(row, "otherOut", amt);
        add(totals, "otherOut", amt);
      } else if (ev.direction === OperatingDirection.IN) {
        add(row, "otherIn", amt);
        add(totals, "otherIn", amt);
      }
      if (isManual && ev.direction === OperatingDirection.OUT) {
        add(row, "manualOut", amt);
        add(totals, "manualOut", amt);
      }
      if (isManual && ev.direction === OperatingDirection.IN) {
        add(row, "manualIn", amt);
        add(totals, "manualIn", amt);
      }
      if (isEst && ev.direction === OperatingDirection.OUT) {
        add(row, "estimatedOut", amt);
        add(totals, "estimatedOut", amt);
      }
    }

    const months = [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({
        month,
        ...v,
        grossMargin: Number((v.revenue - v.refunds - v.cogs).toFixed(2)),
      }));

    const grossMarginTotal = Number(
      (totals.revenue - totals.refunds - totals.cogs).toFixed(2)
    );

    return NextResponse.json({
      success: true,
      year,
      range: { from: start.toISOString(), to: end.toISOString() },
      eventCount: events.length,
      months,
      totals: { ...totals, grossMargin: grossMarginTotal },
    });
  } catch (error: any) {
    console.error("[FINANCE][PL_FROM_OPERATING] Error:", error);
    return NextResponse.json(
      { error: "Failed to build P&L from operating events", details: error.message },
      { status: 500 }
    );
  }
}
