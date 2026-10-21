import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { prisma } from "@/app/lib/prisma";
import { SHOPIFY_SELL_TIMEZONE } from "@/app/utils/shopifySellDate";

const TZ = SHOPIFY_SELL_TIMEZONE;

export type UnlinkedQueueOrder = {
  shopifyOrderId: string;
  orderName: string;
  createdAt: Date;
  /** YYYY-MM-DD sell day in Europe/Zurich */
  sellDateKey: string;
  netSalesChf: number;
};

export type StockxBuyQueuePlan = {
  timezone: typeof TZ;
  lagDays: number;
  monthKey: string;
  todayKey: string;
  cutoffSellDateKey: string;
  oldestUnlinkedSellDateKey: string | null;
  oldestUnlinkedOrderName: string | null;
  /** Unlinked orders this month (before lag/cohort filters). */
  unlinkedThisMonth: UnlinkedQueueOrder[];
  /** Lag-eligible unlinked (sell day ≤ today − lagDays). */
  lagEligible: UnlinkedQueueOrder[];
  /** Oldest sell-day cohort within lag-eligible — what a run would process. */
  cohort: UnlinkedQueueOrder[];
  cohortSellDateKey: string | null;
  orderNamesIfRunNow: string[];
};

function isYmd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function addDaysYmd(ymd: string, days: number): string {
  if (!isYmd(ymd)) throw new Error("date must be YYYY-MM-DD");
  const [y, m, d] = ymd.split("-").map(Number);
  const utc = new Date(Date.UTC(y!, m! - 1, d!));
  utc.setUTCDate(utc.getUTCDate() + days);
  const yy = utc.getUTCFullYear();
  const mm = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(utc.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function zurichSellDateKey(d: Date): string {
  return formatInTimeZone(d, TZ, "yyyy-MM-dd");
}

export function zurichTodayKey(now: Date = new Date()): string {
  return formatInTimeZone(now, TZ, "yyyy-MM-dd");
}

/** Calendar month bounds in Europe/Zurich → UTC [start, endExclusive). */
export function zurichMonthBounds(now: Date = new Date()): {
  monthKey: string;
  start: Date;
  endExclusive: Date;
} {
  const monthKey = formatInTimeZone(now, TZ, "yyyy-MM");
  const start = fromZonedTime(`${monthKey}-01T00:00:00.000`, TZ);
  const [y, m] = monthKey.split("-").map(Number);
  const nextMonth =
    m === 12 ? `${y! + 1}-01` : `${y!}-${String(m! + 1).padStart(2, "0")}`;
  const endExclusive = fromZonedTime(`${nextMonth}-01T00:00:00.000`, TZ);
  return { monthKey, start, endExclusive };
}

/** Default 5 (~4–5 day cashflow lag). Override: STOCKX_BUY_LAG_DAYS. */
export function getBuyLagDays(envValue?: string | null): number {
  const raw = envValue ?? process.env.STOCKX_BUY_LAG_DAYS;
  if (raw == null || String(raw).trim() === "") return 5;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 5;
  return Math.min(30, Math.max(0, Math.floor(n)));
}

export function cutoffSellDateKey(todayKey: string, lagDays: number): string {
  return addDaysYmd(todayKey, -lagDays);
}

/** Keep orders whose Zurich sell day is on/before cutoff (today − lagDays). */
export function filterByLag(
  orders: UnlinkedQueueOrder[],
  lagDays: number,
  todayKey: string
): UnlinkedQueueOrder[] {
  const cutoff = cutoffSellDateKey(todayKey, lagDays);
  return orders.filter((o) => o.sellDateKey <= cutoff);
}

/**
 * Among candidates, take the oldest sell day and every order on that day.
 * Sorted ascending by createdAt within the day.
 */
export function oldestCohort(orders: UnlinkedQueueOrder[]): {
  sellDateKey: string | null;
  orders: UnlinkedQueueOrder[];
} {
  if (!orders.length) return { sellDateKey: null, orders: [] };
  let oldest = orders[0]!.sellDateKey;
  for (const o of orders) {
    if (o.sellDateKey < oldest) oldest = o.sellDateKey;
  }
  const cohort = orders
    .filter((o) => o.sellDateKey === oldest)
    .slice()
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return { sellDateKey: oldest, orders: cohort };
}

function normalizeFinancialStatus(raw: string | null | undefined): string {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
}

function isFullyRefundedOrVoid(status: string): boolean {
  return status === "REFUNDED" || status === "VOIDED";
}

/**
 * Shopify orders in the current Zurich calendar month with net>0, not cancelled /
 * fully refunded, and no OrderMatch yet (by name or id).
 */
export async function listUnlinkedStockxNeededThisMonth(
  now: Date = new Date()
): Promise<UnlinkedQueueOrder[]> {
  const { start, endExclusive } = zurichMonthBounds(now);
  const orders = await prisma.shopifyOrder.findMany({
    where: {
      createdAt: { gte: start, lt: endExclusive },
      cancelledAt: null,
    },
    select: {
      shopifyOrderId: true,
      orderName: true,
      createdAt: true,
      financialStatus: true,
      totalSalesChf: true,
      netSalesChf: true,
      refundedAmountChf: true,
    },
    orderBy: { createdAt: "asc" },
  });
  if (!orders.length) return [];

  const names = orders.map((o) => o.orderName);
  const ids = orders.map((o) => o.shopifyOrderId);
  const matched = await prisma.orderMatch.findMany({
    where: {
      OR: [{ shopifyOrderName: { in: names } }, { shopifyOrderId: { in: ids } }],
    },
    select: { shopifyOrderName: true, shopifyOrderId: true },
  });
  const matchedNames = new Set(
    matched.map((m) => m.shopifyOrderName).filter(Boolean) as string[]
  );
  const matchedIds = new Set(
    matched.map((m) => m.shopifyOrderId).filter(Boolean) as string[]
  );

  const out: UnlinkedQueueOrder[] = [];
  for (const o of orders) {
    if (matchedNames.has(o.orderName) || matchedIds.has(o.shopifyOrderId)) continue;
    const status = normalizeFinancialStatus(o.financialStatus);
    if (isFullyRefundedOrVoid(status)) continue;
    const gross = Number(o.totalSalesChf ?? 0);
    const refunded = Number(o.refundedAmountChf ?? 0);
    const net =
      o.netSalesChf != null ? Number(o.netSalesChf) : gross - refunded;
    if (!(net > 0)) continue;
    out.push({
      shopifyOrderId: o.shopifyOrderId,
      orderName: o.orderName,
      createdAt: o.createdAt,
      sellDateKey: zurichSellDateKey(o.createdAt),
      netSalesChf: Number(net.toFixed(2)),
    });
  }
  return out;
}

/** Pure plan from an unlinked list (testable). */
export function planBuyQueueFromOrders(
  unlinkedThisMonth: UnlinkedQueueOrder[],
  opts?: { lagDays?: number; now?: Date }
): StockxBuyQueuePlan {
  const now = opts?.now ?? new Date();
  const lagDays = opts?.lagDays ?? getBuyLagDays();
  const todayKey = zurichTodayKey(now);
  const { monthKey } = zurichMonthBounds(now);
  const cutoff = cutoffSellDateKey(todayKey, lagDays);
  const lagEligible = filterByLag(unlinkedThisMonth, lagDays, todayKey);
  const { sellDateKey: cohortSellDateKey, orders: cohort } = oldestCohort(lagEligible);
  const oldestOverall = oldestCohort(unlinkedThisMonth);

  return {
    timezone: TZ,
    lagDays,
    monthKey,
    todayKey,
    cutoffSellDateKey: cutoff,
    oldestUnlinkedSellDateKey: oldestOverall.sellDateKey,
    oldestUnlinkedOrderName: oldestOverall.orders[0]?.orderName ?? null,
    unlinkedThisMonth,
    lagEligible,
    cohort,
    cohortSellDateKey,
    orderNamesIfRunNow: cohort.map((o) => o.orderName),
  };
}

/**
 * Cashflow buy queue: current Zurich month → lag filter → oldest sell-day cohort.
 * Answers: oldest unlinked this month + which orders would run now.
 */
export async function dryRunPlan(opts?: {
  lagDays?: number;
  now?: Date;
}): Promise<StockxBuyQueuePlan> {
  const now = opts?.now ?? new Date();
  const unlinked = await listUnlinkedStockxNeededThisMonth(now);
  return planBuyQueueFromOrders(unlinked, {
    lagDays: opts?.lagDays ?? getBuyLagDays(),
    now,
  });
}
