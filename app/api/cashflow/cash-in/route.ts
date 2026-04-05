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

type CashInEvent = {
  orderId: string;
  channel: ChannelKey;
  amount: number;
  expectedCashInDate: string;
  orderDate: string;
  paymentMethod?: string | null;
};

type CashInRuleRow = {
  channel: ChannelKey;
  paymentMethod: string | null;
  delayType: "BUSINESS_DAYS" | "CALENDAR_DAYS" | "NEXT_FRIDAY";
  delayValueDays: number | null;
  priority: number;
};

const DEFAULT_RULES: CashInRuleRow[] = [
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
  const date = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  return endOfDay
    ? new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999))
    : date;
}

function getGatewayLabel(gateways?: string[] | null) {
  if (!gateways?.length) return null;
  return gateways.join(" | ");
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
  if (rule.delayType === "NEXT_FRIDAY") {
    return nextFriday(orderDate);
  }
  const delay = rule.delayValueDays ?? 0;
  if (rule.delayType === "BUSINESS_DAYS") {
    return addBusinessDays(orderDate, delay);
  }
  return addCalendarDays(orderDate, delay);
}

function maxDelayDays(rules: CashInRuleRow[]) {
  return rules.reduce((max, rule) => {
    if (rule.delayType === "NEXT_FRIDAY") return Math.max(max, 7);
    const val = rule.delayValueDays ?? 0;
    return Math.max(max, Math.ceil(val));
  }, 0);
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

    const ruleRows = await prisma.cashInRule.findMany({
      where: { active: true },
      orderBy: [{ priority: "desc" }],
    });

    const rules: CashInRuleRow[] = ruleRows.length
      ? ruleRows.map((rule) => ({
          channel: rule.channel as ChannelKey,
          paymentMethod: rule.paymentMethod,
          delayType: rule.delayType,
          delayValueDays: rule.delayValueDays ? toNumberSafe(rule.delayValueDays, 0) : null,
          priority: rule.priority,
        }))
      : DEFAULT_RULES;

    const maxDelay = maxDelayDays(rules);
    const orderWindowStart = new Date(startDate);
    orderWindowStart.setUTCDate(orderWindowStart.getUTCDate() - (maxDelay + 7));

    const orderWindowEnd = new Date(endDate);
    orderWindowEnd.setUTCDate(orderWindowEnd.getUTCDate() + (maxDelay + 7));

    const events: CashInEvent[] = [];

    if (channelFilter.has("SHOPIFY")) {
      const shopifyOrders = await prisma.shopifyOrder.findMany({
        where: {
          createdAt: {
            gte: orderWindowStart,
            lte: orderWindowEnd,
          },
        },
        select: {
          shopifyOrderId: true,
          createdAt: true,
          totalSalesChf: true,
          netSalesChf: true,
          paymentGatewayNames: true,
        },
      });

      for (const order of shopifyOrders) {
        const rule = matchRule("SHOPIFY", order.paymentGatewayNames, rules);
        if (!rule) continue;
        const amount =
          toNumberSafe(order.netSalesChf, 0) || toNumberSafe(order.totalSalesChf, 0);
        if (amount <= 0) continue;

        const expectedDate = applyDelay(order.createdAt, rule);
        if (expectedDate < startDate || expectedDate > endDate) continue;

        events.push({
          orderId: order.shopifyOrderId,
          channel: "SHOPIFY",
          amount: Number(amount.toFixed(2)),
          expectedCashInDate: toDateKey(expectedDate),
          orderDate: toDateKey(order.createdAt),
          paymentMethod: getGatewayLabel(order.paymentGatewayNames),
        });
      }
    }

    if (channelFilter.has("GALAXUS")) {
      const lines = await prisma.galaxusOrderLine.findMany({
        where: {
          order: {
            orderDate: { gte: orderWindowStart, lte: orderWindowEnd },
          },
        },
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
        const entry = byOrder.get(line.orderId)!;
        entry.amount += amount;
      }

      for (const [orderId, entry] of byOrder.entries()) {
        const rule = matchRule("GALAXUS", null, rules);
        if (!rule || entry.amount <= 0) continue;
        const expectedDate = applyDelay(entry.date, rule);
        if (expectedDate < startDate || expectedDate > endDate) continue;
        events.push({
          orderId,
          channel: "GALAXUS",
          amount: Number(entry.amount.toFixed(2)),
          expectedCashInDate: toDateKey(expectedDate),
          orderDate: toDateKey(entry.date),
        });
      }
    }

    if (channelFilter.has("DECATHLON")) {
      const lines = await prisma.decathlonOrderLine.findMany({
        where: {
          order: {
            orderDate: { gte: orderWindowStart, lte: orderWindowEnd },
          },
        },
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
        const total = toNumberSafe(line.lineTotal, 0);
        const fallback = toNumberSafe(line.unitPrice, 0) * Number(line.quantity ?? 0);
        const amount = total > 0 ? total : fallback;
        if (!byOrder.has(line.orderId)) {
          byOrder.set(line.orderId, { date: orderDate, amount: 0 });
        }
        const entry = byOrder.get(line.orderId)!;
        entry.amount += amount;
      }

      for (const [orderId, entry] of byOrder.entries()) {
        const rule = matchRule("DECATHLON", null, rules);
        if (!rule || entry.amount <= 0) continue;
        const expectedDate = applyDelay(entry.date, rule);
        if (expectedDate < startDate || expectedDate > endDate) continue;
        events.push({
          orderId,
          channel: "DECATHLON",
          amount: Number(entry.amount.toFixed(2)),
          expectedCashInDate: toDateKey(expectedDate),
          orderDate: toDateKey(entry.date),
        });
      }
    }

    return NextResponse.json({
      events,
      metadata: {
        startDate: toDateKey(startDate),
        endDate: toDateKey(endDate),
        timezone: CASHFLOW_TIMEZONE,
        channels: Array.from(channelFilter),
        days: buildDateRange(startDate, endDate).length,
      },
    });
  } catch (error: any) {
    console.error("[CASHFLOW/CASH-IN] Error:", error);
    return NextResponse.json(
      { error: "Failed to build cash-in events", details: error.message },
      { status: 500 }
    );
  }
}
