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
type ForecastMode = "AUTO" | "MANUAL" | "HYBRID";

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
  source: "order" | "projection";
};

type CashOutEvent = {
  date: string;
  amount: number;
  category: string;
  channel?: ChannelKey | null;
  source?: "order" | "projection" | "fixed";
};

type ObservedStats = {
  observedDays: number;
  totalSales: number;
  avgDailySales: number;
  conservativeDailySales: number;
};

const OBSERVED_WINDOW_DAYS = 90;
const OBSERVED_MIN_DAYS = 30;

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

function confidenceLevel(observedDays: number) {
  if (observedDays >= 60) return "high";
  if (observedDays >= 30) return "medium";
  if (observedDays >= 10) return "low";
  return "very_low";
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

function scenarioMultiplier(value: string | null) {
  if (!value) return 1;
  switch (value.toLowerCase()) {
    case "conservative":
      return 0.8;
    case "growth":
      return 1.15;
    default:
      return 1;
  }
}

function effectiveGrowthRate(value: number, scenario: string | null) {
  if (scenario?.toLowerCase() === "conservative") {
    return Math.min(0, value);
  }
  return value;
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

function normalizeAssumption(channel: ChannelKey, raw?: any) {
  return {
    channel,
    mode: (raw?.mode || "HYBRID") as ForecastMode,
    expectedDailySales: toNumberSafe(raw?.expectedDailySales, 0),
    expectedDailyOrders: raw?.expectedDailyOrders ?? null,
    growthRatePct: toNumberSafe(raw?.growthRatePct, 0),
    payoutDelayDays:
      raw?.payoutDelayDays === null || raw?.payoutDelayDays === undefined
        ? null
        : toNumberSafe(raw?.payoutDelayDays, 0),
    commissionRatePct: toNumberSafe(raw?.commissionRatePct, 0),
    refundRatePct: toNumberSafe(raw?.refundRatePct, 0),
  };
}

async function computeShopifyObserved(start: Date, end: Date) {
  const orders = await prisma.shopifyOrder.findMany({
    where: { createdAt: { gte: start, lte: end } },
    select: { createdAt: true, totalSalesChf: true, netSalesChf: true },
  });
  const byDate = new Map<string, number>();
  let total = 0;
  for (const order of orders) {
    const amount =
      toNumberSafe(order.netSalesChf, 0) || toNumberSafe(order.totalSalesChf, 0);
    if (amount <= 0) continue;
    const key = toDateKey(order.createdAt);
    byDate.set(key, (byDate.get(key) || 0) + amount);
    total += amount;
  }
  const observedDays = Array.from(byDate.values()).filter((v) => v > 0).length;
  const avgDailySales = observedDays > 0 ? total / observedDays : 0;
  const conservativeDailySales = total / OBSERVED_WINDOW_DAYS;
  return { observedDays, totalSales: total, avgDailySales, conservativeDailySales };
}

async function computeGalaxusObserved(start: Date, end: Date) {
  const lines = await prisma.galaxusOrderLine.findMany({
    where: { order: { orderDate: { gte: start, lte: end } } },
    select: {
      lineNetAmount: true,
      unitNetPrice: true,
      quantity: true,
      order: { select: { orderDate: true } },
    },
  });
  const byDate = new Map<string, number>();
  let total = 0;
  for (const line of lines) {
    const orderDate = line.order?.orderDate;
    if (!orderDate) continue;
    const net = toNumberSafe(line.lineNetAmount, 0);
    const fallback = toNumberSafe(line.unitNetPrice, 0) * Number(line.quantity ?? 0);
    const amount = net > 0 ? net : fallback;
    if (amount <= 0) continue;
    const key = toDateKey(orderDate);
    byDate.set(key, (byDate.get(key) || 0) + amount);
    total += amount;
  }
  const observedDays = Array.from(byDate.values()).filter((v) => v > 0).length;
  const avgDailySales = observedDays > 0 ? total / observedDays : 0;
  const conservativeDailySales = total / OBSERVED_WINDOW_DAYS;
  return { observedDays, totalSales: total, avgDailySales, conservativeDailySales };
}

async function computeDecathlonObserved(start: Date, end: Date) {
  const lines = await prisma.decathlonOrderLine.findMany({
    where: { order: { orderDate: { gte: start, lte: end } } },
    select: {
      lineTotal: true,
      unitPrice: true,
      quantity: true,
      order: { select: { orderDate: true } },
    },
  });
  const byDate = new Map<string, number>();
  let total = 0;
  for (const line of lines) {
    const orderDate = line.order?.orderDate;
    if (!orderDate) continue;
    const totalLine = toNumberSafe(line.lineTotal, 0);
    const fallback = toNumberSafe(line.unitPrice, 0) * Number(line.quantity ?? 0);
    const amount = totalLine > 0 ? totalLine : fallback;
    if (amount <= 0) continue;
    const key = toDateKey(orderDate);
    byDate.set(key, (byDate.get(key) || 0) + amount);
    total += amount;
  }
  const observedDays = Array.from(byDate.values()).filter((v) => v > 0).length;
  const avgDailySales = observedDays > 0 ? total / observedDays : 0;
  const conservativeDailySales = total / OBSERVED_WINDOW_DAYS;
  return { observedDays, totalSales: total, avgDailySales, conservativeDailySales };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const range = Number(searchParams.get("range") || 30);
    const projectionDays = Number(searchParams.get("projection") || 30);
    const scenario = searchParams.get("scenario");
    const channelsParam = searchParams.getAll("channels");
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");

    const endDate = parseDateParam(toParam, true) ?? endOfTodayZurich();
    const startDate =
      parseDateParam(fromParam, false) ??
      new Date(endDate.getTime() - (range - 1) * 24 * 60 * 60 * 1000);
    const projectionEnd = addCalendarDays(endDate, Math.max(projectionDays, 0));
    const observedStart = addCalendarDays(endDate, -(OBSERVED_WINDOW_DAYS - 1));

    const channelFilter = new Set<ChannelKey>(
      channelsParam.length
        ? (channelsParam.map((c) => c.toUpperCase()) as ChannelKey[])
        : ["SHOPIFY", "GALAXUS", "DECATHLON"]
    );

    const [config, cashInRuleRows, cashOutRuleRows, assumptionRows] = await Promise.all([
      prisma.cashFlowConfig.findFirst(),
      prisma.cashInRule.findMany({ where: { active: true }, orderBy: [{ priority: "desc" }] }),
      prisma.cashOutRule.findMany({ where: { active: true } }),
      prisma.forecastAssumption.findMany(),
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

    const assumptionByChannel = new Map<ChannelKey, ReturnType<typeof normalizeAssumption>>();
    for (const channel of ["SHOPIFY", "GALAXUS", "DECATHLON"] as ChannelKey[]) {
      const raw = assumptionRows.find((row) => row.channel === channel);
      assumptionByChannel.set(channel, normalizeAssumption(channel, raw));
    }

    const [shopifyObserved, galaxusObserved, decathlonObserved] = await Promise.all([
      computeShopifyObserved(observedStart, endDate),
      computeGalaxusObserved(observedStart, endDate),
      computeDecathlonObserved(observedStart, endDate),
    ]);

    const observedByChannel: Record<ChannelKey, ObservedStats> = {
      SHOPIFY: shopifyObserved,
      GALAXUS: galaxusObserved,
      DECATHLON: decathlonObserved,
    };

    const confidenceByChannel = Object.fromEntries(
      (Object.keys(observedByChannel) as ChannelKey[]).map((channel) => {
        const observedDays = observedByChannel[channel].observedDays;
        return [
          channel,
          { observedDays, level: confidenceLevel(observedDays) },
        ];
      })
    ) as Record<ChannelKey, { observedDays: number; level: string }>;

    const warnings: string[] = [];
    for (const channel of Object.keys(confidenceByChannel) as ChannelKey[]) {
      if (confidenceByChannel[channel].observedDays < OBSERVED_MIN_DAYS) {
        warnings.push(
          "Forecast quality is limited because some channels have less than 30 observed days of data."
        );
        break;
      }
    }

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

    const maxRuleDelay = cashInRules.reduce((max, rule) => {
      if (rule.delayType === "NEXT_FRIDAY") return Math.max(max, 7);
      const val = rule.delayValueDays ?? 0;
      return Math.max(max, Math.ceil(val));
    }, 0);
    const maxManualDelay = Array.from(assumptionByChannel.values()).reduce(
      (max, assumption) =>
        Math.max(max, assumption.payoutDelayDays ? Math.ceil(assumption.payoutDelayDays) : 0),
      0
    );
    const orderWindowStart = addCalendarDays(startDate, -(maxRuleDelay + maxManualDelay + 7));
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
    const adSpendRecent = await prisma.dailyAdSpend.findMany({
      where: { date: { gte: observedStart, lte: endDate } },
    });

    let adSpendTotal = 0;
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
    for (const record of adSpendRecent) {
      adSpendTotal += toNumberSafe(record.amountChf, 0);
    }
    const adSpendAvg = OBSERVED_WINDOW_DAYS > 0 ? adSpendTotal / OBSERVED_WINDOW_DAYS : 0;

    if (projectionDays > 0 && adSpendAvg > 0) {
      const futureDates = buildDateRange(addCalendarDays(endDate, 1), projectionEnd);
      for (const date of futureDates) {
        cashOutEvents.push({
          date: toDateKey(date),
          amount: Number(adSpendAvg.toFixed(2)),
          category: "ADS",
          source: "projection",
        });
      }
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

    if (projectionDays > 0) {
      const futureDates = buildDateRange(addCalendarDays(endDate, 1), projectionEnd);
      const scenarioFactor = scenarioMultiplier(scenario);

      for (const channel of channelFilter) {
        const observed = observedByChannel[channel];
        const assumption = assumptionByChannel.get(channel)!;
        const observedDays = observed.observedDays;
        const mode = assumption.mode;

        let baseDailyGross = 0;
        let forecastSource = "auto";

        if (mode === "MANUAL") {
          baseDailyGross = assumption.expectedDailySales;
          forecastSource = "manual";
        } else if (mode === "AUTO") {
          if (observedDays >= OBSERVED_MIN_DAYS) {
            baseDailyGross = observed.avgDailySales;
          } else {
            baseDailyGross = observed.conservativeDailySales;
          }
          forecastSource = "auto";
        } else {
          if (observedDays >= OBSERVED_MIN_DAYS) {
            baseDailyGross = observed.avgDailySales;
            forecastSource = "hybrid-auto";
          } else {
            baseDailyGross = assumption.expectedDailySales;
            forecastSource = "hybrid-manual";
          }
        }

        baseDailyGross = baseDailyGross * scenarioFactor;
        const commissionRate = Math.max(0, Math.min(100, assumption.commissionRatePct));
        const refundRate = Math.max(0, Math.min(100, assumption.refundRatePct));
        const netFactor = Math.max(0, 1 - commissionRate / 100 - refundRate / 100);
        const growthRate = effectiveGrowthRate(assumption.growthRatePct, scenario) / 100;

        futureDates.forEach((date, index) => {
          if (baseDailyGross <= 0) return;
          const growthMultiplier = Math.pow(1 + growthRate, index);
          const gross = baseDailyGross * growthMultiplier;
          const net = gross * netFactor;
          if (net <= 0) return;

          const manualDelay =
            (forecastSource.includes("manual") && assumption.payoutDelayDays != null)
              ? assumption.payoutDelayDays
              : null;

          let expectedDate: Date;
          if (manualDelay != null) {
            expectedDate = addCalendarDays(date, manualDelay);
          } else {
            const rule = matchRule(channel, null, cashInRules);
            if (!rule) return;
            expectedDate = applyDelay(date, rule);
          }

          if (expectedDate >= startDate && expectedDate <= projectionEnd) {
            cashInEvents.push({
              date: toDateKey(expectedDate),
              amount: Number(net.toFixed(2)),
              channel,
              source: "projection",
            });
          }

          const ratio = cogsRatioByChannel.get(channel) || 0;
          if (ratio > 0) {
            const projectedCogs = gross * ratio;
            const outDate = addCalendarDays(date, cogsOffsetDays);
            if (outDate >= startDate && outDate <= projectionEnd) {
              cashOutEvents.push({
                date: toDateKey(outDate),
                amount: Number(projectedCogs.toFixed(2)),
                category: "COGS",
                channel,
                source: "projection",
              });
            }
          }
        });
      }
    }

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
      isForecast: boolean;
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
        isForecast: day > endDate,
      });
      balance = closingBalance;
      minBalance = Math.min(minBalance, closingBalance);
      if (day <= endDate) closingAtEnd = closingBalance;
      closingAtProjection = closingBalance;
    }

    const forecastRows = rows.filter((row) => row.isForecast);
    const forecastCashInByChannel: Record<ChannelKey, number> = {
      SHOPIFY: 0,
      GALAXUS: 0,
      DECATHLON: 0,
    };
    const forecastCashOutByCategory: Record<string, number> = {};

    const forecastDatesSet = new Set(forecastRows.map((row) => row.date));

    for (const event of cashInEvents) {
      if (!forecastDatesSet.has(event.date)) continue;
      if (event.source !== "projection") continue;
      forecastCashInByChannel[event.channel] += event.amount;
    }

    for (const event of cashOutEvents) {
      if (!forecastDatesSet.has(event.date)) continue;
      if (event.source !== "projection" && event.source !== "fixed") continue;
      forecastCashOutByCategory[event.category] =
        (forecastCashOutByCategory[event.category] || 0) + event.amount;
    }

    const assumptionsUsed = (Object.keys(observedByChannel) as ChannelKey[]).map((channel) => {
      const assumption = assumptionByChannel.get(channel)!;
      const observed = observedByChannel[channel];
      const confidence = confidenceByChannel[channel].level;
      let forecastSource = assumption.mode.toLowerCase();
      if (assumption.mode === "HYBRID") {
        forecastSource =
          observed.observedDays >= OBSERVED_MIN_DAYS ? "hybrid-auto" : "hybrid-manual";
      }
      if (assumption.mode === "AUTO" && observed.observedDays < OBSERVED_MIN_DAYS) {
        forecastSource = "auto-conservative";
      }
      return {
        channel,
        mode: assumption.mode,
        expectedDailySales: assumption.expectedDailySales,
        expectedDailyOrders: assumption.expectedDailyOrders,
        growthRatePct: assumption.growthRatePct,
        payoutDelayDays: assumption.payoutDelayDays,
        commissionRatePct: assumption.commissionRatePct,
        refundRatePct: assumption.refundRatePct,
        observedDays: observed.observedDays,
        confidence,
        forecastSource,
      };
    });

    return NextResponse.json({
      rows,
      kpis: {
        minBalance: Number(minBalance.toFixed(2)),
        currentBalance: Number(closingAtEnd.toFixed(2)),
        projectedBalance: Number(closingAtProjection.toFixed(2)),
      },
      confidenceByChannel,
      assumptionsUsed,
      warnings,
      forecastBreakdown: {
        cashInByChannel: {
          SHOPIFY: Number(forecastCashInByChannel.SHOPIFY.toFixed(2)),
          GALAXUS: Number(forecastCashInByChannel.GALAXUS.toFixed(2)),
          DECATHLON: Number(forecastCashInByChannel.DECATHLON.toFixed(2)),
        },
        cashOut: {
          COGS: Number((forecastCashOutByCategory.COGS || 0).toFixed(2)),
          ADS: Number((forecastCashOutByCategory.ADS || 0).toFixed(2)),
          SHIPPING: Number((forecastCashOutByCategory.SHIPPING || 0).toFixed(2)),
          OWNER_DRAW: Number((forecastCashOutByCategory.OWNER_DRAW || 0).toFixed(2)),
          FIXED: Number(
            (
              (forecastCashOutByCategory.SUBSCRIPTION || 0) +
              (forecastCashOutByCategory.INSURANCE || 0) +
              (forecastCashOutByCategory.FUEL || 0) +
              (forecastCashOutByCategory.OTHER || 0)
            ).toFixed(2)
          ),
        },
      },
      metadata: {
        startDate: toDateKey(startDate),
        endDate: toDateKey(endDate),
        projectionEnd: toDateKey(projectionEnd),
        scenario: scenario || "base",
        timezone: CASHFLOW_TIMEZONE,
        channels: Array.from(channelFilter),
        observedWindowDays: OBSERVED_WINDOW_DAYS,
        observedWindowStart: toDateKey(observedStart),
        observedWindowEnd: toDateKey(endDate),
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
