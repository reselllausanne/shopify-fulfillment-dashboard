/**
 * Sync CANCELLED / REFUNDED onto linked Shopify + Galaxus matches from StockX
 * buying HISTORICAL (live order history), not Gmail.
 *
 * Ops alerts only read DB `stockxStatus`. AWB often never refreshes rows that
 * already have an AWB (e.g. stuck AC_RECEIVED after StockX cancels) — this
 * closes that gap before the hourly digest runs.
 */
import { prisma } from "@/app/lib/prisma";
import { getCachedStockxBuyingOrders } from "@/galaxus/stx/buyingOrdersCache";
import type { StockxBuyingNode } from "@/galaxus/stx/stockxClient";
import { listStockxAccountTokens } from "@/lib/stockxToken";

export type TerminalBuyStatus = "CANCELLED" | "REFUNDED";

export function normalizeStockxBuyOrderNumber(raw: string | null | undefined): string {
  return String(raw ?? "")
    .trim()
    .toUpperCase();
}

/** Pure: map a buying-list node to CANCELLED / REFUNDED, else null. */
export function terminalStatusFromBuyingNode(
  node: Pick<StockxBuyingNode, "state"> & { status?: string | null }
): TerminalBuyStatus | null {
  const key = String(node.state?.statusKey ?? "").trim().toUpperCase();
  const title = String(node.state?.statusTitle ?? "").trim().toUpperCase();
  const loose = String((node as { status?: string | null }).status ?? "").trim().toUpperCase();
  const blob = `${key} ${title} ${loose}`;
  if (blob.includes("CANCEL")) return "CANCELLED";
  if (blob.includes("REFUND")) return "REFUNDED";
  return null;
}

export type HistoricalCancelSyncResult = {
  ok: boolean;
  accounts: number;
  historyNodes: number;
  terminalNodes: number;
  shopifyUpdated: number;
  galaxusUpdated: number;
  orderNumbers: string[];
  error?: string;
};

/**
 * Pull HISTORICAL buys across all known StockX accounts; write CANCELLED/REFUNDED
 * onto linked matches whose DB status is still non-terminal.
 */
export async function syncLinkedMatchesFromStockxHistory(options?: {
  maxPages?: number;
  first?: number;
  forceRefresh?: boolean;
}): Promise<HistoricalCancelSyncResult> {
  const maxPages = Math.max(1, Math.min(8, Number(options?.maxPages ?? 5) || 5));
  const first = Math.max(20, Math.min(100, Number(options?.first ?? 50) || 50));
  const forceRefresh = Boolean(options?.forceRefresh);

  const empty: HistoricalCancelSyncResult = {
    ok: true,
    accounts: 0,
    historyNodes: 0,
    terminalNodes: 0,
    shopifyUpdated: 0,
    galaxusUpdated: 0,
    orderNumbers: [],
  };

  let accounts: Awaited<ReturnType<typeof listStockxAccountTokens>>;
  try {
    accounts = await listStockxAccountTokens();
  } catch (err: any) {
    return {
      ...empty,
      ok: false,
      error: `list_tokens: ${err?.message ?? err}`,
    };
  }
  if (!accounts.length) {
    return { ...empty, ok: false, error: "no_stockx_tokens" };
  }

  const byOrder = new Map<string, TerminalBuyStatus>();
  let historyNodes = 0;

  for (const acc of accounts) {
    try {
      const hist = await getCachedStockxBuyingOrders(acc.token, {
        state: "HISTORICAL",
        first,
        maxPages,
        forceRefresh,
      });
      historyNodes += hist.nodes.length;
      for (const node of hist.nodes) {
        const num = normalizeStockxBuyOrderNumber(node.orderNumber);
        if (!num.startsWith("0")) continue;
        const terminal = terminalStatusFromBuyingNode(node);
        if (!terminal) continue;
        // Prefer CANCELLED if both somehow appear.
        const prev = byOrder.get(num);
        if (prev === "CANCELLED") continue;
        byOrder.set(num, terminal);
      }
    } catch (err: any) {
      console.warn(
        "[STOCKX][HIST_CANCEL] account history fetch failed:",
        err?.message ?? err
      );
    }
  }

  const orderNumbers = Array.from(byOrder.keys());
  if (!orderNumbers.length) {
    return {
      ...empty,
      ok: true,
      accounts: accounts.length,
      historyNodes,
      terminalNodes: 0,
    };
  }

  const prismaAny = prisma as any;
  let shopifyUpdated = 0;
  let galaxusUpdated = 0;

  // Shopify OrderMatch — only bump non-terminal rows.
  try {
    const shopifyRows = await prisma.orderMatch.findMany({
      where: {
        stockxOrderNumber: { in: orderNumbers },
        NOT: { stockxStatus: { in: ["CANCELLED", "REFUNDED"] } },
      },
      select: { id: true, stockxOrderNumber: true, stockxStatus: true },
    });
    for (const row of shopifyRows) {
      const next = byOrder.get(normalizeStockxBuyOrderNumber(row.stockxOrderNumber));
      if (!next) continue;
      await prisma.orderMatch.update({
        where: { id: row.id },
        data: { stockxStatus: next },
      });
      shopifyUpdated += 1;
    }
  } catch (err: any) {
    console.warn("[STOCKX][HIST_CANCEL] shopify update failed:", err?.message ?? err);
  }

  // GalaxusStockxMatch — same.
  try {
    const gxRows = await prismaAny.galaxusStockxMatch.findMany({
      where: {
        stockxOrderNumber: { in: orderNumbers },
        NOT: { stockxStatus: { in: ["CANCELLED", "REFUNDED"] } },
      },
      select: { id: true, stockxOrderNumber: true, stockxStatus: true },
    });
    for (const row of gxRows) {
      const next = byOrder.get(normalizeStockxBuyOrderNumber(row.stockxOrderNumber));
      if (!next) continue;
      await prismaAny.galaxusStockxMatch.update({
        where: { id: row.id },
        data: { stockxStatus: next, updatedAt: new Date() },
      });
      galaxusUpdated += 1;
    }
  } catch (err: any) {
    console.warn("[STOCKX][HIST_CANCEL] galaxus update failed:", err?.message ?? err);
  }

  if (shopifyUpdated || galaxusUpdated) {
    console.log(
      `[STOCKX][HIST_CANCEL] accounts=${accounts.length} hist=${historyNodes} terminal=${orderNumbers.length} shopify=${shopifyUpdated} galaxus=${galaxusUpdated}`
    );
  }

  return {
    ok: true,
    accounts: accounts.length,
    historyNodes,
    terminalNodes: orderNumbers.length,
    shopifyUpdated,
    galaxusUpdated,
    orderNumbers: orderNumbers.slice(0, 50),
  };
}
