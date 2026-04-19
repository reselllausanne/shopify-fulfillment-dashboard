import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { toNumberSafe } from "@/app/utils/numbers";
import { toZonedTime } from "date-fns-tz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIMEZONE = "Europe/Zurich";
const DEFAULT_RANGE_DAYS = 30;
const MAX_RANGE_DAYS = 366;

type ChannelKey = "shopify" | "galaxus" | "decathlon";

type DailyChannelRow = {
  date: string;
  channel: ChannelKey;
  salesChf: number;
  salesWithCogsChf: number;
  cogsChf: number;
  marginChf: number;
  ordersCount: number;
  lineItemsCount: number;
  matchedCogsCount: number;
  missingCogsCount: number;
};

type ChannelTotals = Omit<DailyChannelRow, "date" | "channel">;

type ReconciliationRow = {
  date: string;
  bookedSalesChf: number;
  matchedSalesChf: number;
  bookedOrdersCount: number;
  matchedOrdersCount: number;
};

const CHANNELS: ChannelKey[] = ["shopify", "galaxus", "decathlon"];

const initTotals = (): ChannelTotals => ({
  salesChf: 0,
  salesWithCogsChf: 0,
  cogsChf: 0,
  marginChf: 0,
  ordersCount: 0,
  lineItemsCount: 0,
  matchedCogsCount: 0,
  missingCogsCount: 0,
});

const channelOrder = new Map<ChannelKey, number>([
  ["shopify", 0],
  ["galaxus", 1],
  ["decathlon", 2],
]);

function dateKeyFromDate(date: Date) {
  return date.toISOString().split("T")[0];
}

function parseDateParam(value: string, endOfDay: boolean) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [yearRaw, monthRaw, dayRaw] = value.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!year || !month || !day) return null;
  return new Date(
    Date.UTC(
      year,
      month - 1,
      day,
      endOfDay ? 23 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 999 : 0
    )
  );
}

function diffDays(start: Date, end: Date) {
  const diffMs = end.getTime() - start.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");
    const rangeParam = parseInt(
      searchParams.get("range") || `${DEFAULT_RANGE_DAYS}`
    );

    if (isNaN(rangeParam) || rangeParam < 1 || rangeParam > MAX_RANGE_DAYS) {
      return NextResponse.json(
        { error: `Invalid range parameter. Must be between 1 and ${MAX_RANGE_DAYS}.` },
        { status: 400 }
      );
    }

    const nowZurich = toZonedTime(new Date(), TIMEZONE);
    const defaultEndDate = new Date(
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
    const defaultStartDate = new Date(
      Date.UTC(
        nowZurich.getFullYear(),
        nowZurich.getMonth(),
        nowZurich.getDate() - (rangeParam - 1),
        0,
        0,
        0,
        0
      )
    );

    let startDate = defaultStartDate;
    let endDate = defaultEndDate;

    if (fromParam) {
      const parsed = parseDateParam(fromParam, false);
      if (!parsed) {
        return NextResponse.json(
          { error: "Invalid from parameter. Use YYYY-MM-DD." },
          { status: 400 }
        );
      }
      startDate = parsed;
    }

    if (toParam) {
      const parsed = parseDateParam(toParam, true);
      if (!parsed) {
        return NextResponse.json(
          { error: "Invalid to parameter. Use YYYY-MM-DD." },
          { status: 400 }
        );
      }
      endDate = parsed;
    } else if (!fromParam) {
      endDate = defaultEndDate;
    }

    if (!fromParam && toParam) {
      startDate = new Date(
        Date.UTC(
          endDate.getUTCFullYear(),
          endDate.getUTCMonth(),
          endDate.getUTCDate() - (rangeParam - 1),
          0,
          0,
          0,
          0
        )
      );
    }

    if (startDate > endDate) {
      return NextResponse.json(
        { error: "from date must be before to date." },
        { status: 400 }
      );
    }

    const rangeDays = diffDays(startDate, endDate);
    if (rangeDays > MAX_RANGE_DAYS) {
      return NextResponse.json(
        { error: `Date range too large. Max ${MAX_RANGE_DAYS} days.` },
        { status: 400 }
      );
    }

    const requestedChannels = searchParams.getAll("channels");
    const channelSet = new Set<ChannelKey>(
      requestedChannels.length
        ? (requestedChannels.filter((c): c is ChannelKey =>
            CHANNELS.includes(c as ChannelKey)
          ) as ChannelKey[])
        : CHANNELS
    );

    const dailyMap = new Map<string, DailyChannelRow>();
    const orderIdsByDay: Record<ChannelKey, Map<string, Set<string>>> = {
      shopify: new Map(),
      galaxus: new Map(),
      decathlon: new Map(),
    };

    const ensureRow = (dateKey: string, channel: ChannelKey) => {
      const key = `${dateKey}|${channel}`;
      if (!dailyMap.has(key)) {
        dailyMap.set(key, {
          date: dateKey,
          channel,
          salesChf: 0,
          salesWithCogsChf: 0,
          cogsChf: 0,
          marginChf: 0,
          ordersCount: 0,
          lineItemsCount: 0,
          matchedCogsCount: 0,
          missingCogsCount: 0,
        });
      }
      return dailyMap.get(key)!;
    };

    const addOrder = (channel: ChannelKey, dateKey: string, orderId?: string | null) => {
      if (!orderId) return;
      const map = orderIdsByDay[channel];
      const set = map.get(dateKey) ?? new Set<string>();
      set.add(orderId);
      map.set(dateKey, set);
      ensureRow(dateKey, channel).ordersCount = set.size;
    };

    let shopifyBookedByDate: Map<string, { sales: number; orders: Set<string> }> | null =
      null;

    if (channelSet.has("shopify")) {
      const [matches, orders] = await Promise.all([
        prisma.orderMatch.findMany({
          where: {
            shopifyCreatedAt: {
              gte: startDate,
              lte: endDate,
            },
          },
          select: {
            shopifyOrderId: true,
            shopifyCreatedAt: true,
            shopifyTotalPrice: true,
            manualRevenueAdjustment: true,
            supplierCost: true,
            manualCostOverride: true,
            returnReason: true,
            returnFeePercent: true,
            returnFeeAmountChf: true,
          },
        }),
        prisma.shopifyOrder.findMany({
          where: {
            createdAt: {
              gte: startDate,
              lte: endDate,
            },
          },
          select: {
            shopifyOrderId: true,
            createdAt: true,
            totalSalesChf: true,
          },
        }),
      ]);

      for (const m of matches) {
        if (!m.shopifyCreatedAt) continue;
        const dateKey = dateKeyFromDate(m.shopifyCreatedAt);
        const row = ensureRow(dateKey, "shopify");
        row.lineItemsCount += 1;
        addOrder("shopify", dateKey, m.shopifyOrderId);

        const baseRevenue =
          toNumberSafe(m.shopifyTotalPrice, 0) +
          toNumberSafe(m.manualRevenueAdjustment, 0);
        const returnFeePercent = toNumberSafe(m.returnFeePercent, 0);
        const returnFeeAmount = m.returnReason
          ? toNumberSafe(
              m.returnFeeAmountChf,
              returnFeePercent > 0
                ? (toNumberSafe(m.shopifyTotalPrice, 0) * returnFeePercent) / 100
                : 0
            )
          : 0;
        const revenue = m.returnReason ? returnFeeAmount : baseRevenue;
        row.salesChf += revenue;

        const cost =
          toNumberSafe(m.manualCostOverride, 0) || toNumberSafe(m.supplierCost, 0);
        if (cost > 0) {
          row.salesWithCogsChf += revenue;
          row.cogsChf += cost;
          row.marginChf += revenue - cost;
          row.matchedCogsCount += 1;
        } else {
          row.missingCogsCount += 1;
        }
      }

      shopifyBookedByDate = new Map<string, { sales: number; orders: Set<string> }>();
      for (const order of orders) {
        const dateKey = dateKeyFromDate(order.createdAt);
        const entry =
          shopifyBookedByDate.get(dateKey) ?? { sales: 0, orders: new Set<string>() };
        entry.sales += toNumberSafe(order.totalSalesChf, 0);
        if (order.shopifyOrderId) {
          entry.orders.add(order.shopifyOrderId);
        }
        shopifyBookedByDate.set(dateKey, entry);
      }
    }

    if (channelSet.has("galaxus")) {
      const [lines, matches] = await Promise.all([
        prisma.galaxusOrderLine.findMany({
          where: {
            order: {
              orderDate: { gte: startDate, lte: endDate },
            },
          },
          select: {
            id: true,
            orderId: true,
            lineNetAmount: true,
            unitNetPrice: true,
            quantity: true,
            order: { select: { orderDate: true } },
          },
        }),
        prisma.galaxusStockxMatch.findMany({
          where: {
            order: {
              orderDate: { gte: startDate, lte: endDate },
            },
          },
          select: {
            galaxusOrderLineId: true,
            stockxAmount: true,
          },
        }),
      ]);

      const costByLine = new Map<string, number>();
      for (const match of matches) {
        if (!match.galaxusOrderLineId) continue;
        const cost = toNumberSafe(match.stockxAmount, 0);
        if (cost > 0) costByLine.set(match.galaxusOrderLineId, cost);
      }

      for (const line of lines) {
        const orderDate = line.order?.orderDate;
        if (!orderDate) continue;
        const dateKey = dateKeyFromDate(orderDate);
        const row = ensureRow(dateKey, "galaxus");
        row.lineItemsCount += 1;
        addOrder("galaxus", dateKey, line.orderId);

        const lineNet = toNumberSafe(line.lineNetAmount, 0);
        const unitNet = toNumberSafe(line.unitNetPrice, 0);
        const quantity = Number(line.quantity ?? 0);
        const revenue = lineNet > 0 ? lineNet : unitNet * quantity;
        row.salesChf += revenue;

        const cost = costByLine.get(line.id);
        if (cost && cost > 0) {
          row.salesWithCogsChf += revenue;
          row.cogsChf += cost;
          row.marginChf += revenue - cost;
          row.matchedCogsCount += 1;
        } else {
          row.missingCogsCount += 1;
        }
      }
    }

    if (channelSet.has("decathlon")) {
      const [lines, matches] = await Promise.all([
        prisma.decathlonOrderLine.findMany({
          where: {
            order: {
              orderDate: { gte: startDate, lte: endDate },
            },
          },
          select: {
            id: true,
            orderId: true,
            lineTotal: true,
            unitPrice: true,
            quantity: true,
            order: { select: { orderDate: true } },
          },
        }),
        prisma.decathlonStockxMatch.findMany({
          where: {
            order: {
              orderDate: { gte: startDate, lte: endDate },
            },
          },
          select: {
            decathlonOrderLineId: true,
            stockxAmount: true,
          },
        }),
      ]);

      const costByLine = new Map<string, number>();
      for (const match of matches) {
        if (!match.decathlonOrderLineId) continue;
        const cost = toNumberSafe(match.stockxAmount, 0);
        if (cost > 0) costByLine.set(match.decathlonOrderLineId, cost);
      }

      for (const line of lines) {
        const orderDate = line.order?.orderDate;
        if (!orderDate) continue;
        const dateKey = dateKeyFromDate(orderDate);
        const row = ensureRow(dateKey, "decathlon");
        row.lineItemsCount += 1;
        addOrder("decathlon", dateKey, line.orderId);

        const lineTotal = toNumberSafe(line.lineTotal, 0);
        const unitPrice = toNumberSafe(line.unitPrice, 0);
        const quantity = Number(line.quantity ?? 0);
        const revenue = lineTotal > 0 ? lineTotal : unitPrice * quantity;
        row.salesChf += revenue;

        const cost = costByLine.get(line.id);
        if (cost && cost > 0) {
          row.salesWithCogsChf += revenue;
          row.cogsChf += cost;
          row.marginChf += revenue - cost;
          row.matchedCogsCount += 1;
        } else {
          row.missingCogsCount += 1;
        }
      }
    }

    const rows = Array.from(dailyMap.values())
      .map((row) => ({
        ...row,
        salesChf: Number(row.salesChf.toFixed(2)),
        salesWithCogsChf: Number(row.salesWithCogsChf.toFixed(2)),
        cogsChf: Number(row.cogsChf.toFixed(2)),
        marginChf: Number(row.marginChf.toFixed(2)),
      }))
      .sort((a, b) => {
        const dateCmp = a.date.localeCompare(b.date);
        if (dateCmp !== 0) return dateCmp;
        return (channelOrder.get(a.channel) ?? 0) - (channelOrder.get(b.channel) ?? 0);
      });

    const totalsByChannel: Record<ChannelKey, ChannelTotals> = {
      shopify: initTotals(),
      galaxus: initTotals(),
      decathlon: initTotals(),
    };
    const overallTotals = initTotals();

    for (const row of rows) {
      const bucket = totalsByChannel[row.channel];
      bucket.salesChf += row.salesChf;
      bucket.salesWithCogsChf += row.salesWithCogsChf;
      bucket.cogsChf += row.cogsChf;
      bucket.marginChf += row.marginChf;
      bucket.ordersCount += row.ordersCount;
      bucket.lineItemsCount += row.lineItemsCount;
      bucket.matchedCogsCount += row.matchedCogsCount;
      bucket.missingCogsCount += row.missingCogsCount;

      overallTotals.salesChf += row.salesChf;
      overallTotals.salesWithCogsChf += row.salesWithCogsChf;
      overallTotals.cogsChf += row.cogsChf;
      overallTotals.marginChf += row.marginChf;
      overallTotals.ordersCount += row.ordersCount;
      overallTotals.lineItemsCount += row.lineItemsCount;
      overallTotals.matchedCogsCount += row.matchedCogsCount;
      overallTotals.missingCogsCount += row.missingCogsCount;
    }

    const roundedTotalsByChannel = Object.fromEntries(
      Object.entries(totalsByChannel).map(([key, totals]) => [
        key,
        {
          ...totals,
          salesChf: Number(totals.salesChf.toFixed(2)),
          salesWithCogsChf: Number(totals.salesWithCogsChf.toFixed(2)),
          cogsChf: Number(totals.cogsChf.toFixed(2)),
          marginChf: Number(totals.marginChf.toFixed(2)),
        },
      ])
    ) as Record<ChannelKey, ChannelTotals>;

    const reconciliation =
      channelSet.has("shopify") && shopifyBookedByDate
        ? (() => {
            const matchedByDate = new Map<
              string,
              { sales: number; ordersCount: number }
            >();
            for (const row of rows) {
              if (row.channel !== "shopify") continue;
              matchedByDate.set(row.date, {
                sales: row.salesChf,
                ordersCount: row.ordersCount,
              });
            }

            const allDates = new Set<string>([
              ...shopifyBookedByDate.keys(),
              ...matchedByDate.keys(),
            ]);

            const reconciliationRows: ReconciliationRow[] = Array.from(allDates)
              .sort((a, b) => a.localeCompare(b))
              .map((date) => {
                const booked = shopifyBookedByDate?.get(date);
                const matched = matchedByDate.get(date);
                return {
                  date,
                  bookedSalesChf: Number((booked?.sales || 0).toFixed(2)),
                  matchedSalesChf: Number((matched?.sales || 0).toFixed(2)),
                  bookedOrdersCount: booked?.orders.size || 0,
                  matchedOrdersCount: matched?.ordersCount || 0,
                };
              });

            const totals = reconciliationRows.reduce(
              (acc, row) => {
                acc.bookedSalesChf += row.bookedSalesChf;
                acc.matchedSalesChf += row.matchedSalesChf;
                acc.bookedOrdersCount += row.bookedOrdersCount;
                acc.matchedOrdersCount += row.matchedOrdersCount;
                return acc;
              },
              {
                bookedSalesChf: 0,
                matchedSalesChf: 0,
                bookedOrdersCount: 0,
                matchedOrdersCount: 0,
              }
            );

            return {
              rows: reconciliationRows,
              totals: {
                bookedSalesChf: Number(totals.bookedSalesChf.toFixed(2)),
                matchedSalesChf: Number(totals.matchedSalesChf.toFixed(2)),
                bookedOrdersCount: totals.bookedOrdersCount,
                matchedOrdersCount: totals.matchedOrdersCount,
              },
            };
          })()
        : null;

    return NextResponse.json({
      rows,
      totals: {
        overall: {
          ...overallTotals,
          salesChf: Number(overallTotals.salesChf.toFixed(2)),
          salesWithCogsChf: Number(overallTotals.salesWithCogsChf.toFixed(2)),
          cogsChf: Number(overallTotals.cogsChf.toFixed(2)),
          marginChf: Number(overallTotals.marginChf.toFixed(2)),
        },
        byChannel: roundedTotalsByChannel,
      },
      reconciliation,
      metadata: {
        startDate: dateKeyFromDate(startDate),
        endDate: dateKeyFromDate(endDate),
        rangeDays,
        timezone: TIMEZONE,
        channels: Array.from(channelSet),
      },
    });
  } catch (error: any) {
    console.error("[METRICS/CASHFLOW/DAILY] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch cashflow daily metrics", details: error.message },
      { status: 500 }
    );
  }
}
