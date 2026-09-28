import { prisma } from "@/app/lib/prisma";
import {
  autoLinkUnclaimedStockxBuysForGalaxusOrder,
  filterGalaxusLinesNeedingStockxAutoLink,
} from "@/galaxus/orders/autoLinkStockxBuys";
import { reconcileGalaxusOrderProcurement } from "@/galaxus/orders/galaxusProcurementReconcile";
import { shouldSkipGalaxusOrderForMatching } from "@/galaxus/orders/openGalaxusOrderFilter";
import { getCachedStockxBuyingOrders } from "@/galaxus/stx/buyingOrdersCache";
import type { StockxBuyingNode } from "@/galaxus/stx/stockxClient";
import { listStockxAccountTokens } from "@/lib/stockxToken";

export type GalaxusAutoLinkSweepOptions = {
  days?: number;
  maxOrders?: number;
  /** Stop starting new orders after this many ms (cron route shares its budget). */
  budgetMs?: number;
};

export type GalaxusAutoLinkSweepResult = {
  ok: boolean;
  error?: string;
  candidateOrders: number;
  processedOrders: number;
  linked: number;
  ensuredMatches: number;
  buysFetched: number;
  accounts: number;
  budgetExhausted: boolean;
  perOrder: Array<{ galaxusOrderId: string; linked: number; reason?: string }>;
};

const STX_LINE_FILTER = {
  OR: [
    { providerKey: { startsWith: "STX_", mode: "insensitive" as const } },
    { supplierVariantId: { startsWith: "stx_", mode: "insensitive" as const } },
    { supplierPid: { startsWith: "STX_", mode: "insensitive" as const } },
  ],
};

/**
 * Re-run StockX auto-link for open Galaxus orders whose STX units are still unlinked.
 * Ingest-time auto-link runs before the buy exists; this catches buys placed afterwards
 * (any account, PENDING + recent HISTORICAL) with one shared buying-list fetch.
 */
export async function runGalaxusStockxAutoLinkSweep(
  options?: GalaxusAutoLinkSweepOptions
): Promise<GalaxusAutoLinkSweepResult> {
  const startedAt = Date.now();
  const days = Math.max(1, Math.min(90, Number(options?.days ?? 30)));
  const maxOrders = Math.max(1, Math.min(500, Number(options?.maxOrders ?? 200)));
  const budgetMs = Math.max(10_000, Number(options?.budgetMs ?? 240_000));

  const result: GalaxusAutoLinkSweepResult = {
    ok: true,
    candidateOrders: 0,
    processedOrders: 0,
    linked: 0,
    ensuredMatches: 0,
    buysFetched: 0,
    accounts: 0,
    budgetExhausted: false,
    perOrder: [],
  };

  const since = new Date(Date.now() - days * 86_400_000);
  const orders = await prisma.galaxusOrder.findMany({
    where: {
      archivedAt: null,
      cancelledAt: null,
      orderDate: { gte: since },
      lines: { some: STX_LINE_FILTER },
    },
    include: { lines: true },
    orderBy: { orderDate: "asc" },
  });
  if (orders.length === 0) return result;

  const matches = await (prisma as any).galaxusStockxMatch.findMany({
    where: { galaxusOrderId: { in: orders.map((o) => o.id) } },
    select: { galaxusOrderId: true, galaxusOrderLineId: true, stockxOrderNumber: true },
  });
  const matchesByOrder = new Map<string, any[]>();
  for (const m of matches) {
    const key = String(m.galaxusOrderId);
    const arr = matchesByOrder.get(key) ?? [];
    arr.push(m);
    matchesByOrder.set(key, arr);
  }

  const candidates = orders
    .filter(
      (order) =>
        !shouldSkipGalaxusOrderForMatching({
          cancelledAt: order.cancelledAt,
          archivedAt: order.archivedAt,
          lines: order.lines ?? [],
        }) &&
        filterGalaxusLinesNeedingStockxAutoLink(order.lines ?? [], matchesByOrder.get(order.id) ?? [])
          .length > 0
    )
    .slice(0, maxOrders);
  result.candidateOrders = candidates.length;
  if (candidates.length === 0) return result;

  const tokens = await listStockxAccountTokens();
  result.accounts = tokens.length;
  if (tokens.length === 0) {
    return { ...result, ok: false, error: "no_stockx_token" };
  }

  const prefetchedBuys: Array<{ node: StockxBuyingNode; token: string }> = [];
  const seen = new Set<string>();
  for (const account of tokens) {
    for (const [state, maxPages] of [
      ["PENDING", 8],
      ["HISTORICAL", 4],
    ] as const) {
      const res = await getCachedStockxBuyingOrders(account.token, {
        first: 100,
        maxPages,
        state,
      }).catch((err: any) => {
        console.warn("[GALAXUS][STX][AUTO_LINK_SWEEP] buying list failed", {
          source: account.source,
          state,
          error: err?.message ?? err,
        });
        return null;
      });
      for (const node of res?.nodes ?? []) {
        const key = `${String(node.orderId ?? "").trim()}::${String(node.orderNumber ?? "").trim()}`;
        if (key === "::" || seen.has(key)) continue;
        seen.add(key);
        prefetchedBuys.push({ node, token: account.token });
      }
    }
  }
  result.buysFetched = prefetchedBuys.length;
  if (prefetchedBuys.length === 0) {
    return { ...result, ok: false, error: "no_stockx_buys_fetched" };
  }

  for (const order of candidates) {
    if (Date.now() - startedAt > budgetMs) {
      result.budgetExhausted = true;
      break;
    }
    try {
      const reconcile = await reconcileGalaxusOrderProcurement(order.id, { skipAutoLink: true });
      if (reconcile.ok) result.ensuredMatches += reconcile.ensuredMatches;
      const linkRes = await autoLinkUnclaimedStockxBuysForGalaxusOrder(order.id, {
        skipReserve: true,
        prefetchedBuys,
      });
      result.linked += linkRes.linked;
      result.processedOrders += 1;
      if (linkRes.linked > 0 || (reconcile.ok && reconcile.ensuredMatches > 0)) {
        result.perOrder.push({
          galaxusOrderId: order.galaxusOrderId,
          linked: linkRes.linked,
        });
      }
    } catch (err: any) {
      result.processedOrders += 1;
      result.perOrder.push({
        galaxusOrderId: order.galaxusOrderId,
        linked: 0,
        reason: String(err?.message ?? err).slice(0, 200),
      });
    }
  }

  return result;
}
