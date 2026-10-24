/**
 * DB-only automatic-buy candidate engine (NO browser, NO proxy, NO buys).
 *
 * Builds the daily "what can I buy on StockX" plan from Shopify orders that have no
 * linked StockX purchase yet, running the DB pre-check per line and ranking the
 * buyable ones oldest-first, customer-Express first, within an optional budget.
 *
 * Shopify line resolution is injected (`loadLine`) so this stays Playwright-free and
 * unit-testable. Pure ranking/budget helpers (`rankCandidates`, `applyBudget`) are
 * exported for tests.
 */
import { prisma } from "@/app/lib/prisma";
import {
  desiredStockxLaneFromShopify,
  detectShopifyExpress,
} from "@/lib/stockxAutoCheckout/detectShopifyExpress";
import {
  getStockxFeedHeartbeat,
  precheckStockxBuyability,
  type PrecheckLine,
  type PrecheckResult,
} from "@/lib/stockxAutoCheckout/precheckAvailability";
import type { StockxPrecheckStatus } from "@/lib/stockxAutoCheckout/types";

/**
 * Stable express-first partition (own copy — importing shopifyBatchBuy's helper would
 * drag Playwright into this DB-only module). Input order is preserved within groups.
 */
function stableExpressFirst<T>(items: T[], isExpress: (item: T) => boolean): T[] {
  const express: T[] = [];
  const rest: T[] = [];
  for (const item of items) (isExpress(item) ? express : rest).push(item);
  return [...express, ...rest];
}

/** Line shape the loader must return (PrecheckLine + delivery/express signals). */
export type BuyCandidateLine = PrecheckLine & {
  shopifyLineItemId?: string | null;
  deliveryMode?: string | null;
  deliveryModeLabel?: string | null;
  shippingLineTitles?: Array<string | null | undefined> | null;
};

/** Resolve the representative StockX line for a Shopify order (network/DB — injected). */
export type ShopifyLineLoader = (orderName: string) => Promise<BuyCandidateLine | null>;

export type BuyCandidate = {
  orderName: string;
  orderDate: Date;
  shopifyLineItemId: string | null;
  title: string;
  sizeEU: string;
  express: boolean;
  precheck: PrecheckResult;
};

export type SelectBuyCandidatesOptions = {
  sinceDate?: Date;
  /** Max orders to evaluate (bounds Shopify line loads). Default 100. */
  maxCount?: number;
  budgetChf?: number;
  /** Reserved: ShopifyOrder has no channel column yet — currently a no-op filter. */
  channel?: string | null;
  loadLine: ShopifyLineLoader;
  marginFloorPct?: number;
  staleHours?: number;
  now?: Date;
  /** Persist each verdict into PrecheckResult (default true). */
  persist?: boolean;
  /** Re-check even orders previously flagged oos_no_ask / too_expensive. */
  force?: boolean;
};

export type SelectBuyCandidatesResult = {
  /** Every evaluated line, ranked (express-first, oldest-first within group). */
  candidates: BuyCandidate[];
  /** Buyable subset within budget + maxCount, in priority order. */
  selected: BuyCandidate[];
  /** Orders skipped because a prior run flagged them unbuyable (sticky). */
  skippedKnownUnbuyable: number;
  totalBuyChf: number;
};

const DEFAULT_MAX_COUNT = 100;

/** Statuses that are "sticky" — a prior run already decided, don't re-probe. */
const STICKY_UNBUYABLE: ReadonlySet<StockxPrecheckStatus> = new Set([
  "oos_no_ask",
  "too_expensive",
]);

/** First day of October of the given date's year (default scan window start). */
export function defaultSinceDate(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), 9, 1, 0, 0, 0, 0));
}

/**
 * Express-first, stable within groups. Input MUST already be oldest-first so the
 * stable partition preserves oldest-first inside both the express and standard groups.
 */
export function rankCandidates(candidates: BuyCandidate[]): BuyCandidate[] {
  return stableExpressFirst(candidates, (c) => c.express);
}

/**
 * Greedy budget fill over an already-ranked list: keep buyable lines in priority
 * order while the cumulative expectedBuyChf stays within budget; stop at the first
 * line that would overflow (so a cheap low-priority line never jumps a pricier
 * high-priority one). maxSelected caps the count.
 */
export function applyBudget(
  ranked: BuyCandidate[],
  opts: { budgetChf?: number; maxSelected?: number }
): { selected: BuyCandidate[]; totalBuyChf: number } {
  const selected: BuyCandidate[] = [];
  let total = 0;
  for (const c of ranked) {
    if (c.precheck.status !== "buyable") continue;
    if (opts.maxSelected != null && selected.length >= opts.maxSelected) break;
    const buy = c.precheck.expectedBuyChf ?? 0;
    if (opts.budgetChf != null && total + buy > opts.budgetChf) break;
    selected.push(c);
    total += buy;
  }
  return { selected, totalBuyChf: Number(total.toFixed(2)) };
}

async function persistPrecheck(
  orderName: string,
  shopifyLineItemId: string | null,
  precheck: PrecheckResult,
  now: Date
): Promise<void> {
  const where = {
    shopifyOrderName_shopifyLineItemId: {
      shopifyOrderName: orderName,
      shopifyLineItemId: shopifyLineItemId ?? "",
    },
  };
  const data = {
    status: precheck.status,
    reason: precheck.detail,
    lane: precheck.lane,
    expectedBuyChf: precheck.expectedBuyChf,
    sellChf: precheck.sellChf,
    marginPct: precheck.marginPct,
    stock: precheck.stock,
    supplierVariantId: precheck.supplierVariantId,
    checkedAt: now,
  };
  await (prisma as any).precheckResult.upsert({
    where,
    create: {
      shopifyOrderName: orderName,
      shopifyLineItemId: shopifyLineItemId ?? "",
      ...data,
    },
    update: data,
  });
}

/**
 * Build the ranked buy plan.
 *
 * 1. Shopify orders since `sinceDate` (default Oct 1 this year), not cancelled, net>0.
 * 2. Exclude orders already linked to a StockX purchase (OrderMatch w/ number).
 * 3. Exclude orders a prior run flagged sticky-unbuyable (oos_no_ask / too_expensive)
 *    unless `force`; stale_data and others are re-checked.
 * 4. Oldest-first, load the representative line, pre-check it, persist the verdict.
 * 5. Rank express-first (stable), then greedy budget + maxCount.
 */
export async function selectBuyCandidates(
  opts: SelectBuyCandidatesOptions
): Promise<SelectBuyCandidatesResult> {
  const now = opts.now ?? new Date();
  const sinceDate = opts.sinceDate ?? defaultSinceDate(now);
  const maxCount = opts.maxCount ?? DEFAULT_MAX_COUNT;
  const persist = opts.persist !== false;

  const orders = await prisma.shopifyOrder.findMany({
    where: { createdAt: { gte: sinceDate }, cancelledAt: null },
    select: {
      shopifyOrderId: true,
      orderName: true,
      createdAt: true,
      totalSalesChf: true,
      netSalesChf: true,
      refundedAmountChf: true,
    },
    orderBy: { createdAt: "asc" }, // oldest first
    take: 2000,
  });
  if (!orders.length) {
    return { candidates: [], selected: [], skippedKnownUnbuyable: 0, totalBuyChf: 0 };
  }

  const names = orders.map((o) => o.orderName);
  const ids = orders.map((o) => o.shopifyOrderId);

  // Already linked to a StockX purchase → done, never a candidate.
  const matched = await prisma.orderMatch.findMany({
    where: {
      OR: [{ shopifyOrderName: { in: names } }, { shopifyOrderId: { in: ids } }],
      stockxOrderNumber: { not: "" },
    },
    select: { shopifyOrderName: true, shopifyOrderId: true },
  });
  const matchedNames = new Set(matched.map((m) => m.shopifyOrderName).filter(Boolean) as string[]);
  const matchedIds = new Set(matched.map((m) => m.shopifyOrderId).filter(Boolean) as string[]);

  // Prior sticky-unbuyable verdicts (skip re-probe) unless force.
  const stickySkip = new Set<string>();
  if (!opts.force) {
    const prior = await (prisma as any).precheckResult.findMany({
      where: { shopifyOrderName: { in: names }, status: { in: Array.from(STICKY_UNBUYABLE) } },
      select: { shopifyOrderName: true },
    });
    for (const p of prior as Array<{ shopifyOrderName: string }>) stickySkip.add(p.shopifyOrderName);
  }

  // Resolve the global feed heartbeat once so staleness is judged by SSE liveness,
  // not each row's own (change-only) lastSyncAt.
  const feedLastSyncAt = await getStockxFeedHeartbeat(now);

  const candidates: BuyCandidate[] = [];
  let skippedKnownUnbuyable = 0;

  for (const o of orders) {
    if (candidates.length >= maxCount) break;
    if (matchedNames.has(o.orderName) || matchedIds.has(o.shopifyOrderId)) continue;
    if (stickySkip.has(o.orderName)) {
      skippedKnownUnbuyable++;
      continue;
    }
    const gross = Number(o.totalSalesChf ?? 0);
    const refunded = Number(o.refundedAmountChf ?? 0);
    const net = o.netSalesChf != null ? Number(o.netSalesChf) : gross - refunded;
    if (!(net > 0)) continue;

    const line = await opts.loadLine(o.orderName);
    if (!line) continue;

    const express = detectShopifyExpress({
      deliveryMode: line.deliveryMode ?? null,
      deliveryModeLabel: line.deliveryModeLabel ?? null,
      shippingLineTitles: line.shippingLineTitles ?? null,
    });
    const desiredLane = desiredStockxLaneFromShopify(express);

    const precheck = await precheckStockxBuyability({
      line,
      desiredLane,
      marginFloorPct: opts.marginFloorPct,
      staleHours: opts.staleHours,
      now,
      feedLastSyncAt,
    });

    const shopifyLineItemId = line.shopifyLineItemId ?? null;
    if (persist) {
      await persistPrecheck(o.orderName, shopifyLineItemId, precheck, now).catch((e) => {
        console.warn(`[buy-candidates] persist failed for ${o.orderName}: ${e?.message || e}`);
      });
    }

    candidates.push({
      orderName: o.orderName,
      orderDate: o.createdAt,
      shopifyLineItemId,
      title: line.title ?? o.orderName,
      sizeEU: line.sizeEU,
      express,
      precheck,
    });
  }

  const ranked = rankCandidates(candidates);
  const { selected, totalBuyChf } = applyBudget(ranked, {
    budgetChf: opts.budgetChf,
    maxSelected: opts.maxCount,
  });

  return { candidates: ranked, selected, skippedKnownUnbuyable, totalBuyChf };
}
