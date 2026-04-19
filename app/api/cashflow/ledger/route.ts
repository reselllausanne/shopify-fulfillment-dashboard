import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { toNumberSafe } from "@/app/utils/numbers";
import {
  addBusinessDays,
  addCalendarDays,
  buildDateRange,
  CASHFLOW_TIMEZONE,
  endOfTodayZurich,
  nextFriday,
  toDateKey,
} from "@/app/lib/cashflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChannelKey = "SHOPIFY" | "GALAXUS" | "DECATHLON";

type CashInRuleRow = {
  channel: ChannelKey;
  paymentMethod: string | null;
  delayType: "BUSINESS_DAYS" | "CALENDAR_DAYS" | "NEXT_FRIDAY";
  delayValueDays: number | null;
  priority: number;
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

type CashInEvent = {
  date: string;
  amount: number;
  channel: ChannelKey;
  source: "order";
};

type CashOutEvent = {
  date: string;
  amount: number;
  category: string;
  channel?: ChannelKey | null;
  source?: "order" | "fixed" | "estimated";
};

const DEFAULT_CASH_IN_RULES: CashInRuleRow[] = [
  { channel: "SHOPIFY", paymentMethod: "paypal", delayType: "BUSINESS_DAYS", delayValueDays: 6, priority: 300 },
  { channel: "SHOPIFY", paymentMethod: "twint", delayType: "BUSINESS_DAYS", delayValueDays: 3, priority: 300 },
  { channel: "SHOPIFY", paymentMethod: "powerpay", delayType: "NEXT_FRIDAY", delayValueDays: null, priority: 300 },
  { channel: "SHOPIFY", paymentMethod: null, delayType: "BUSINESS_DAYS", delayValueDays: 4.5, priority: 100 },
  { channel: "GALAXUS", paymentMethod: null, delayType: "CALENDAR_DAYS", delayValueDays: 10, priority: 100 },
  { channel: "DECATHLON", paymentMethod: null, delayType: "CALENDAR_DAYS", delayValueDays: 30, priority: 100 },
];

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


function matchRule(
  channel: ChannelKey,
  gatewayNames: string[] | null | undefined,
  rules: CashInRuleRow[]
) {
  const channelRules = rules
    .filter((rule) => rule.channel === channel)
    .sort((a, b) => b.priority - a.priority);
  if (!channelRules.length) return null;
  const lowerGateways = (gatewayNames ?? []).map((g) => g.toLowerCase());
  const methodRule = channelRules.find((rule) => {
    if (!rule.paymentMethod) return false;
    const needle = rule.paymentMethod.toLowerCase();
    return lowerGateways.some((name) => name.includes(needle));
  });
  return methodRule ?? channelRules.find((rule) => !rule.paymentMethod) ?? channelRules[0];
}

function applyDelay(orderDate: Date, rule: CashInRuleRow) {
  if (rule.delayType === "NEXT_FRIDAY") return nextFriday(orderDate);
  const delay = rule.delayValueDays ?? 0;
  if (rule.delayType === "BUSINESS_DAYS") return addBusinessDays(orderDate, delay);
  return addCalendarDays(orderDate, delay);
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
          source: "fixed",
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
          source: "fixed",
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
          source: "fixed",
        });
      }
    }
  }

  return events;
}

function ensureDayMap(
  store: Map<ChannelKey, Map<string, number>>,
  channel: ChannelKey
) {
  if (!store.has(channel)) {
    store.set(channel, new Map());
  }
  return store.get(channel)!;
}

function addToDayMap(
  store: Map<ChannelKey, Map<string, number>>,
  channel: ChannelKey,
  dateKey: string,
  amount: number
) {
  if (amount <= 0) return;
  const dayMap = ensureDayMap(store, channel);
  dayMap.set(dateKey, (dayMap.get(dateKey) || 0) + amount);
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
    const projectionEnd = endDate;

    const channelFilter = new Set<ChannelKey>(
      channelsParam.length
        ? (channelsParam.map((c) => c.toUpperCase()) as ChannelKey[])
        : ["SHOPIFY", "GALAXUS", "DECATHLON"]
    );

    const [config, cashInRuleRows, cashOutRuleRows] = await Promise.all([
      prisma.cashFlowConfig.findFirst(),
      prisma.cashInRule.findMany({ where: { active: true }, orderBy: [{ priority: "desc" }] }),
      prisma.cashOutRule.findMany({ where: { active: true } }),
    ]);

    const cashInRules: CashInRuleRow[] = cashInRuleRows.length
      ? cashInRuleRows.map((rule) => ({
          channel: rule.channel as ChannelKey,
          paymentMethod: rule.paymentMethod,
          delayType: rule.delayType,
          delayValueDays: rule.delayValueDays ? toNumberSafe(rule.delayValueDays, 0) : null,
          priority: rule.priority,
        }))
      : DEFAULT_CASH_IN_RULES;

    const cashOutRules: CashOutRuleRow[] = cashOutRuleRows.map((rule) => ({
      category: rule.category,
      cadence: rule.cadence,
      amountChf: rule.amountChf ? toNumberSafe(rule.amountChf, 0) : null,
      dayOfWeek: rule.dayOfWeek ?? null,
      dayOfMonth: rule.dayOfMonth ?? null,
      offsetDays: rule.offsetDays ?? null,
      startDate: rule.startDate ?? null,
      endDate: rule.endDate ?? null,
    }));

    const cogsRule = cashOutRules.find((rule) => rule.category === "COGS");
    const cogsOffsetDays = cogsRule?.offsetDays ?? 0;

    const ownerDrawExists = cashOutRules.some((rule) => rule.category === "OWNER_DRAW");
    if (!ownerDrawExists) {
      cashOutRules.push({
        category: "OWNER_DRAW",
        cadence: "WEEKLY",
        amountChf: 400,
        dayOfWeek: 5,
        dayOfMonth: null,
        offsetDays: null,
        startDate: null,
        endDate: null,
      });
    }

    const cashInEvents: CashInEvent[] = [];
    const cashOutEvents: CashOutEvent[] = [];
    const cogsRatioByChannel = new Map<ChannelKey, number>();
    const salesByDayByChannel = new Map<ChannelKey, Map<string, number>>();
    const matchedCogsByDayByChannel = new Map<ChannelKey, Map<string, number>>();

    const maxRuleDelay = cashInRules.reduce((max, rule) => {
      if (rule.delayType === "NEXT_FRIDAY") return Math.max(max, 7);
      const val = rule.delayValueDays ?? 0;
      return Math.max(max, Math.ceil(val));
    }, 0);
    const orderWindowStart = addCalendarDays(startDate, -(maxRuleDelay + 7));
    const orderWindowEnd = projectionEnd;

    if (channelFilter.has("SHOPIFY")) {
      const orders = await prisma.shopifyOrder.findMany({
        where: { createdAt: { gte: orderWindowStart, lte: orderWindowEnd } },
        select: {
          createdAt: true,
          totalSalesChf: true,
          netSalesChf: true,
          paymentGatewayNames: true,
        },
      });

      for (const order of orders) {
        const amount =
          toNumberSafe(order.netSalesChf, 0) || toNumberSafe(order.totalSalesChf, 0);
        if (amount <= 0) continue;
        const rule = matchRule("SHOPIFY", order.paymentGatewayNames, cashInRules);
        if (!rule) continue;
        const expectedDate = applyDelay(order.createdAt, rule);
        if (expectedDate >= startDate && expectedDate <= projectionEnd) {
          cashInEvents.push({
            date: toDateKey(expectedDate),
            amount: Number(amount.toFixed(2)),
            channel: "SHOPIFY",
            source: "order",
          });
        }
        if (order.createdAt >= startDate && order.createdAt <= endDate) {
          addToDayMap(
            salesByDayByChannel,
            "SHOPIFY",
            toDateKey(order.createdAt),
            amount
          );
        }
      }

      const matches = await prisma.orderMatch.findMany({
        where: { shopifyCreatedAt: { gte: orderWindowStart, lte: orderWindowEnd } },
        select: {
          shopifyCreatedAt: true,
          manualCostOverride: true,
          supplierCost: true,
          shopifyTotalPrice: true,
        },
      });

      let salesWithCogs = 0;
      let cogs = 0;
      for (const match of matches) {
        if (!match.shopifyCreatedAt) continue;
        const cost =
          toNumberSafe(match.manualCostOverride, 0) || toNumberSafe(match.supplierCost, 0);
        if (cost <= 0) continue;
        const sale = toNumberSafe(match.shopifyTotalPrice, 0);
        salesWithCogs += sale;
        cogs += cost;
        addToDayMap(
          matchedCogsByDayByChannel,
          "SHOPIFY",
          toDateKey(match.shopifyCreatedAt),
          cost
        );
        const outDate = addCalendarDays(match.shopifyCreatedAt, cogsOffsetDays);
        if (outDate >= startDate && outDate <= projectionEnd) {
          cashOutEvents.push({
            date: toDateKey(outDate),
            amount: Number(cost.toFixed(2)),
            category: "COGS",
            channel: "SHOPIFY",
            source: "order",
          });
        }
      }
      if (salesWithCogs > 0) {
        cogsRatioByChannel.set("SHOPIFY", cogs / salesWithCogs);
      }
    }

    if (channelFilter.has("GALAXUS")) {
      const lines = await prisma.galaxusOrderLine.findMany({
        where: { order: { orderDate: { gte: orderWindowStart, lte: orderWindowEnd } } },
        select: {
          orderId: true,
          lineNetAmount: true,
          unitNetPrice: true,
          quantity: true,
          order: { select: { orderDate: true } },
        },
      });

      const byOrder = new Map<string, { date: Date; amount: number }>();
      for (const line of lines) {
        const orderDate = line.order?.orderDate;
        if (!orderDate) continue;
        const net = toNumberSafe(line.lineNetAmount, 0);
        const fallback = toNumberSafe(line.unitNetPrice, 0) * Number(line.quantity ?? 0);
        const amount = net > 0 ? net : fallback;
        if (!byOrder.has(line.orderId)) {
          byOrder.set(line.orderId, { date: orderDate, amount: 0 });
        }
        byOrder.get(line.orderId)!.amount += amount;
      }

      for (const entry of byOrder.values()) {
        const rule = matchRule("GALAXUS", null, cashInRules);
        if (!rule || entry.amount <= 0) continue;
        const expectedDate = applyDelay(entry.date, rule);
        if (expectedDate >= startDate && expectedDate <= projectionEnd) {
          cashInEvents.push({
            date: toDateKey(expectedDate),
            amount: Number(entry.amount.toFixed(2)),
            channel: "GALAXUS",
            source: "order",
          });
        }
        if (entry.date >= startDate && entry.date <= endDate) {
          addToDayMap(
            salesByDayByChannel,
            "GALAXUS",
            toDateKey(entry.date),
            entry.amount
          );
        }
      }

      const matches = await prisma.galaxusStockxMatch.findMany({
        where: { order: { orderDate: { gte: orderWindowStart, lte: orderWindowEnd } } },
        select: {
          stockxAmount: true,
          galaxusLineNetAmount: true,
          order: { select: { orderDate: true } },
        },
      });

      let salesWithCogs = 0;
      let cogs = 0;
      for (const match of matches) {
        const orderDate = match.order?.orderDate;
        if (!orderDate) continue;
        const cost = toNumberSafe(match.stockxAmount, 0);
        if (cost <= 0) continue;
        const sale = toNumberSafe(match.galaxusLineNetAmount, 0);
        salesWithCogs += sale;
        cogs += cost;
        addToDayMap(
          matchedCogsByDayByChannel,
          "GALAXUS",
          toDateKey(orderDate),
          cost
        );
        const outDate = addCalendarDays(orderDate, cogsOffsetDays);
        if (outDate >= startDate && outDate <= projectionEnd) {
          cashOutEvents.push({
            date: toDateKey(outDate),
            amount: Number(cost.toFixed(2)),
            category: "COGS",
            channel: "GALAXUS",
            source: "order",
          });
        }
      }
      if (salesWithCogs > 0) {
        cogsRatioByChannel.set("GALAXUS", cogs / salesWithCogs);
      }
    }

    if (channelFilter.has("DECATHLON")) {
      const lines = await prisma.decathlonOrderLine.findMany({
        where: { order: { orderDate: { gte: orderWindowStart, lte: orderWindowEnd } } },
        select: {
          orderId: true,
          lineTotal: true,
          unitPrice: true,
          quantity: true,
          order: { select: { orderDate: true } },
        },
      });

      const byOrder = new Map<string, { date: Date; amount: number }>();
      for (const line of lines) {
        const orderDate = line.order?.orderDate;
        if (!orderDate) continue;
        const totalLine = toNumberSafe(line.lineTotal, 0);
        const fallback = toNumberSafe(line.unitPrice, 0) * Number(line.quantity ?? 0);
        const amount = totalLine > 0 ? totalLine : fallback;
        if (!byOrder.has(line.orderId)) {
          byOrder.set(line.orderId, { date: orderDate, amount: 0 });
        }
        byOrder.get(line.orderId)!.amount += amount;
      }

      for (const entry of byOrder.values()) {
        const rule = matchRule("DECATHLON", null, cashInRules);
        if (!rule || entry.amount <= 0) continue;
        const expectedDate = applyDelay(entry.date, rule);
        if (expectedDate >= startDate && expectedDate <= projectionEnd) {
          cashInEvents.push({
            date: toDateKey(expectedDate),
            amount: Number(entry.amount.toFixed(2)),
            channel: "DECATHLON",
            source: "order",
          });
        }
        if (entry.date >= startDate && entry.date <= endDate) {
          addToDayMap(
            salesByDayByChannel,
            "DECATHLON",
            toDateKey(entry.date),
            entry.amount
          );
        }
      }

      const matches = await prisma.decathlonStockxMatch.findMany({
        where: { order: { orderDate: { gte: orderWindowStart, lte: orderWindowEnd } } },
        select: {
          stockxAmount: true,
          decathlonLineNetAmount: true,
          order: { select: { orderDate: true } },
        },
      });

      let salesWithCogs = 0;
      let cogs = 0;
      for (const match of matches) {
        const orderDate = match.order?.orderDate;
        if (!orderDate) continue;
        const cost = toNumberSafe(match.stockxAmount, 0);
        if (cost <= 0) continue;
        const sale = toNumberSafe(match.decathlonLineNetAmount, 0);
        salesWithCogs += sale;
        cogs += cost;
        addToDayMap(
          matchedCogsByDayByChannel,
          "DECATHLON",
          toDateKey(orderDate),
          cost
        );
        const outDate = addCalendarDays(orderDate, cogsOffsetDays);
        if (outDate >= startDate && outDate <= projectionEnd) {
          cashOutEvents.push({
            date: toDateKey(outDate),
            amount: Number(cost.toFixed(2)),
            category: "COGS",
            channel: "DECATHLON",
            source: "order",
          });
        }
      }
      if (salesWithCogs > 0) {
        cogsRatioByChannel.set("DECATHLON", cogs / salesWithCogs);
      }
    }

    const adSpendRecords = await prisma.dailyAdSpend.findMany({
      where: { date: { gte: startDate, lte: projectionEnd } },
    });
    for (const record of adSpendRecords) {
      const amount = toNumberSafe(record.amountChf, 0);
      if (amount <= 0) continue;
      cashOutEvents.push({
        date: toDateKey(record.date),
        amount: Number(amount.toFixed(2)),
        category: "ADS",
        source: "order",
      });
    }

    const monthlyCosts = await prisma.monthlyVariableCosts.findMany({
      where: {
        year: {
          gte: startDate.getUTCFullYear(),
          lte: projectionEnd.getUTCFullYear(),
        },
      },
    });
    for (const month of monthlyCosts) {
      const monthStart = new Date(Date.UTC(month.year, month.month - 1, 1, 0, 0, 0, 0));
      const monthEnd = new Date(Date.UTC(month.year, month.month, 0, 23, 59, 59, 999));
      if (monthEnd < startDate || monthStart > projectionEnd) continue;
      const totalShipping =
        toNumberSafe(month.postageShippingCostChf, 0) +
        toNumberSafe(month.fulfillmentCostChf, 0);
      if (totalShipping <= 0) continue;
      const daysInMonth = monthEnd.getUTCDate();
      const dailyAmount = totalShipping / daysInMonth;
      const days = buildDateRange(
        monthStart < startDate ? startDate : monthStart,
        monthEnd > projectionEnd ? projectionEnd : monthEnd
      );
      for (const day of days) {
        cashOutEvents.push({
          date: toDateKey(day),
          amount: Number(dailyAmount.toFixed(2)),
          category: "SHIPPING",
          source: "fixed",
        });
      }
    }

    cashOutEvents.push(
      ...buildFixedCostEvents(cashOutRules.filter((r) => r.category !== "COGS"), startDate, projectionEnd)
    );



    const cashInByDate = new Map<string, number>();
    for (const event of cashInEvents) {
      cashInByDate.set(event.date, (cashInByDate.get(event.date) || 0) + event.amount);
    }

    const cashOutByDate = new Map<string, number>();
    for (const event of cashOutEvents) {
      cashOutByDate.set(event.date, (cashOutByDate.get(event.date) || 0) + event.amount);
    }

    const ledgerDates = buildDateRange(startDate, projectionEnd);
    const rows: Array<{
      date: string;
      openingBalance: number;
      cashIn: number;
      cashOut: number;
      closingBalance: number;
    }> = [];

    let balance = toNumberSafe(config?.initialBalanceChf, 0);
    let minBalance = balance;
    let closingAtEnd = balance;
    let closingAtProjection = balance;

    for (const day of ledgerDates) {
      const dateKey = toDateKey(day);
      const cashIn = Number((cashInByDate.get(dateKey) || 0).toFixed(2));
      const cashOut = Number((cashOutByDate.get(dateKey) || 0).toFixed(2));
      const openingBalance = Number(balance.toFixed(2));
      const closingBalance = Number((openingBalance + cashIn - cashOut).toFixed(2));
      rows.push({
        date: dateKey,
        openingBalance,
        cashIn,
        cashOut,
        closingBalance,
      });
      balance = closingBalance;
      minBalance = Math.min(minBalance, closingBalance);
      if (day <= endDate) closingAtEnd = closingBalance;
      closingAtProjection = closingBalance;
    }

    return NextResponse.json({
      rows,
      kpis: {
        minBalance: Number(minBalance.toFixed(2)),
        currentBalance: Number(closingAtEnd.toFixed(2)),
        projectedBalance: Number(closingAtProjection.toFixed(2)),
      },
      metadata: {
        startDate: toDateKey(startDate),
        endDate: toDateKey(endDate),
        projectionEnd: toDateKey(projectionEnd),
        timezone: CASHFLOW_TIMEZONE,
        channels: Array.from(channelFilter),
      },
    });
  } catch (error: any) {
    console.error("[CASHFLOW/LEDGER] Error:", error);
    return NextResponse.json(
      { error: "Failed to build cashflow ledger", details: error.message },
      { status: 500 }
    );
  }
}
