import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { toNumberSafe } from "@/app/utils/numbers";
import {
  addCalendarDays,
  buildDateRange,
  CASHFLOW_TIMEZONE,
  endOfTodayZurich,
  toDateKey,
} from "@/app/lib/cashflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChannelKey = "SHOPIFY" | "GALAXUS" | "DECATHLON";

type CashOutEvent = {
  date: string;
  category: string;
  amount: number;
  channel?: ChannelKey | null;
  source?: string;
};

type CashOutRuleRow = {
  category: string;
  cadence: "DAILY" | "WEEKLY" | "MONTHLY";
  amountChf: number | null;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  offsetDays: number | null;
  startDate: Date | null;
  endDate: Date | null;
};

function parseDateParam(value: string | null, endOfDay: boolean) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [yearRaw, monthRaw, dayRaw] = value.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!year || !month || !day) return null;
  const base = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  return endOfDay
    ? new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999))
    : base;
}

function matchesRuleWindow(date: Date, rule: CashOutRuleRow) {
  if (rule.startDate && date < rule.startDate) return false;
  if (rule.endDate && date > rule.endDate) return false;
  return true;
}

function buildFixedCostEvents(
  rules: CashOutRuleRow[],
  startDate: Date,
  endDate: Date
) {
  const events: CashOutEvent[] = [];
  const days = buildDateRange(startDate, endDate);

  for (const rule of rules) {
    if (!rule.amountChf || rule.amountChf <= 0) continue;
    if (rule.cadence === "DAILY") {
      for (const day of days) {
        if (!matchesRuleWindow(day, rule)) continue;
        events.push({
          date: toDateKey(day),
          category: rule.category,
          amount: Number(rule.amountChf.toFixed(2)),
        });
      }
    }
    if (rule.cadence === "WEEKLY") {
      const targetDow = rule.dayOfWeek ?? 5;
      for (const day of days) {
        if (day.getUTCDay() !== targetDow) continue;
        if (!matchesRuleWindow(day, rule)) continue;
        events.push({
          date: toDateKey(day),
          category: rule.category,
          amount: Number(rule.amountChf.toFixed(2)),
        });
      }
    }
    if (rule.cadence === "MONTHLY") {
      const targetDom = rule.dayOfMonth ?? 1;
      for (const day of days) {
        if (day.getUTCDate() !== targetDom) continue;
        if (!matchesRuleWindow(day, rule)) continue;
        events.push({
          date: toDateKey(day),
          category: rule.category,
          amount: Number(rule.amountChf.toFixed(2)),
        });
      }
    }
  }

  return events;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const range = Number(searchParams.get("range") || 30);
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");
    const channelsParam = searchParams.getAll("channels");

    const endDate = parseDateParam(toParam, true) ?? endOfTodayZurich();
    const startDate =
      parseDateParam(fromParam, false) ??
      new Date(endDate.getTime() - (range - 1) * 24 * 60 * 60 * 1000);

    const channelFilter = new Set<ChannelKey>(
      channelsParam.length
        ? (channelsParam.map((c) => c.toUpperCase()) as ChannelKey[])
        : ["SHOPIFY", "GALAXUS", "DECATHLON"]
    );

    const rulesRaw = await prisma.cashOutRule.findMany({
      where: { active: true },
    });

    const rules: CashOutRuleRow[] = rulesRaw.map((rule) => ({
      category: rule.category,
      cadence: rule.cadence,
      amountChf: rule.amountChf ? toNumberSafe(rule.amountChf, 0) : null,
      dayOfWeek: rule.dayOfWeek ?? null,
      dayOfMonth: rule.dayOfMonth ?? null,
      offsetDays: rule.offsetDays ?? null,
      startDate: rule.startDate ?? null,
      endDate: rule.endDate ?? null,
    }));

    const cogsRule = rules.find((rule) => rule.category === "COGS");
    const cogsOffsetDays = cogsRule?.offsetDays ?? 0;

    const ownerDrawExists = rules.some((rule) => rule.category === "OWNER_DRAW");
    const ownerDrawRule: CashOutRuleRow | null = ownerDrawExists
      ? null
      : {
          category: "OWNER_DRAW",
          cadence: "WEEKLY",
          amountChf: 400,
          dayOfWeek: 5,
          dayOfMonth: null,
          offsetDays: null,
          startDate: null,
          endDate: null,
        };

    const events: CashOutEvent[] = [];

    if (channelFilter.has("SHOPIFY")) {
      const matches = await prisma.orderMatch.findMany({
        where: {
          shopifyCreatedAt: {
            gte: addCalendarDays(startDate, -Math.max(cogsOffsetDays, 0)),
            lte: endDate,
          },
        },
        select: {
          shopifyCreatedAt: true,
          manualCostOverride: true,
          supplierCost: true,
        },
      });

      for (const match of matches) {
        if (!match.shopifyCreatedAt) continue;
        const cost =
          toNumberSafe(match.manualCostOverride, 0) || toNumberSafe(match.supplierCost, 0);
        if (cost <= 0) continue;
        const outDate = addCalendarDays(match.shopifyCreatedAt, cogsOffsetDays);
        if (outDate < startDate || outDate > endDate) continue;
        events.push({
          date: toDateKey(outDate),
          category: "COGS",
          amount: Number(cost.toFixed(2)),
          channel: "SHOPIFY",
        });
      }
    }

    if (channelFilter.has("GALAXUS")) {
      const matches = await prisma.galaxusStockxMatch.findMany({
        where: {
          order: {
            orderDate: {
              gte: addCalendarDays(startDate, -Math.max(cogsOffsetDays, 0)),
              lte: endDate,
            },
          },
        },
        select: {
          stockxAmount: true,
          order: { select: { orderDate: true } },
        },
      });

      for (const match of matches) {
        const orderDate = match.order?.orderDate;
        if (!orderDate) continue;
        const cost = toNumberSafe(match.stockxAmount, 0);
        if (cost <= 0) continue;
        const outDate = addCalendarDays(orderDate, cogsOffsetDays);
        if (outDate < startDate || outDate > endDate) continue;
        events.push({
          date: toDateKey(outDate),
          category: "COGS",
          amount: Number(cost.toFixed(2)),
          channel: "GALAXUS",
        });
      }
    }

    if (channelFilter.has("DECATHLON")) {
      const matches = await prisma.decathlonStockxMatch.findMany({
        where: {
          order: {
            orderDate: {
              gte: addCalendarDays(startDate, -Math.max(cogsOffsetDays, 0)),
              lte: endDate,
            },
          },
        },
        select: {
          stockxAmount: true,
          order: { select: { orderDate: true } },
        },
      });

      for (const match of matches) {
        const orderDate = match.order?.orderDate;
        if (!orderDate) continue;
        const cost = toNumberSafe(match.stockxAmount, 0);
        if (cost <= 0) continue;
        const outDate = addCalendarDays(orderDate, cogsOffsetDays);
        if (outDate < startDate || outDate > endDate) continue;
        events.push({
          date: toDateKey(outDate),
          category: "COGS",
          amount: Number(cost.toFixed(2)),
          channel: "DECATHLON",
        });
      }
    }

    const adSpend = await prisma.dailyAdSpend.findMany({
      where: {
        date: { gte: startDate, lte: endDate },
      },
    });
    for (const record of adSpend) {
      const amount = toNumberSafe(record.amountChf, 0);
      if (amount <= 0) continue;
      events.push({
        date: toDateKey(record.date),
        category: "ADS",
        amount: Number(amount.toFixed(2)),
        source: record.channel ?? "google",
      });
    }

    const months = await prisma.monthlyVariableCosts.findMany({
      where: {
        year: {
          gte: startDate.getUTCFullYear(),
          lte: endDate.getUTCFullYear(),
        },
      },
    });

    for (const month of months) {
      const monthStart = new Date(Date.UTC(month.year, month.month - 1, 1, 0, 0, 0, 0));
      const monthEnd = new Date(Date.UTC(month.year, month.month, 0, 23, 59, 59, 999));
      if (monthEnd < startDate || monthStart > endDate) continue;

      const totalShipping =
        toNumberSafe(month.postageShippingCostChf, 0) +
        toNumberSafe(month.fulfillmentCostChf, 0);
      if (totalShipping <= 0) continue;
      const daysInMonth = monthEnd.getUTCDate();
      const dailyAmount = totalShipping / daysInMonth;
      const days = buildDateRange(
        monthStart < startDate ? startDate : monthStart,
        monthEnd > endDate ? endDate : monthEnd
      );
      for (const day of days) {
        events.push({
          date: toDateKey(day),
          category: "SHIPPING",
          amount: Number(dailyAmount.toFixed(2)),
        });
      }
    }

    const fixedRules = rules.filter((rule) => rule.category !== "COGS");
    if (ownerDrawRule) {
      fixedRules.push(ownerDrawRule);
    }
    events.push(...buildFixedCostEvents(fixedRules, startDate, endDate));

    return NextResponse.json({
      events,
      metadata: {
        startDate: toDateKey(startDate),
        endDate: toDateKey(endDate),
        timezone: CASHFLOW_TIMEZONE,
        channels: Array.from(channelFilter),
      },
    });
  } catch (error: any) {
    console.error("[CASHFLOW/CASH-OUT] Error:", error);
    return NextResponse.json(
      { error: "Failed to build cash-out events", details: error.message },
      { status: 500 }
    );
  }
}
