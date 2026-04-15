import type { DecathlonStockxMatch } from "@prisma/client";
import { createLimiter } from "@/galaxus/jobs/bulkSql";
import { prisma } from "@/app/lib/prisma";
import { fetchStockxBuyOrderDetailsFull } from "@/galaxus/stx/stockxClient";
import {
  applyStockxDetailsToDecathlonMatchFields,
  resolveStockxBuyByOrderNumberWithToken,
} from "@/decathlon/stx/manualStockxEnrich";

export type DecathlonOrderNumberRefreshStats = {
  eligible: number;
  attempted: number;
  refreshed: number;
  awbBackfilled: number;
  failed: number;
  skipped: number;
  failures: Array<{ matchId: string; lineId: string; reason: string }>;
};

function trimStr(v: unknown): string {
  return String(v ?? "").trim();
}

/** True if we can try to pull AWB + details from StockX using saved order # or chain/order id (no variant matching). */
export function decathlonMatchEligibleForOrderNumberRefresh(m: DecathlonStockxMatch): boolean {
  const chain = trimStr(m.stockxChainId);
  const oid = trimStr(m.stockxOrderId);
  if (chain && oid) return true;
  const onum = trimStr(m.stockxOrderNumber);
  if (!onum) return false;
  if (onum.startsWith("MANUAL-")) return false;
  return true;
}

async function refreshOneMatch(
  token: string,
  match: DecathlonStockxMatch
): Promise<{ ok: true; awbBackfilled: boolean } | { ok: false; reason: string }> {
  let listNode: Parameters<typeof applyStockxDetailsToDecathlonMatchFields>[0] = null;
  let details: Awaited<ReturnType<typeof fetchStockxBuyOrderDetailsFull>> | null = null;

  const chain = trimStr(match.stockxChainId);
  const oid = trimStr(match.stockxOrderId);
  if (chain && oid) {
    try {
      details = await fetchStockxBuyOrderDetailsFull(token, { chainId: chain, orderId: oid });
    } catch {
      details = null;
    }
  }

  if (!details?.order) {
    const onum = trimStr(match.stockxOrderNumber);
    if (!onum || onum.startsWith("MANUAL-")) {
      return { ok: false, reason: "no_stockx_ref" };
    }
    const resolved = await resolveStockxBuyByOrderNumberWithToken(token, onum);
    if (!resolved.ok) return { ok: false, reason: resolved.reason };
    listNode = resolved.listNode;
    details = resolved.details;
  }

  if (!details?.order) return { ok: false, reason: "no_order_in_response" };

  const stockxPatch = applyStockxDetailsToDecathlonMatchFields(listNode, details, {
    matchReasons: ["DECATHLON_STOCKX_ORDER_NUMBER_SYNC"],
  });
  const hadAwb = trimStr(match.stockxAwb);
  const nextAwb = trimStr(stockxPatch.stockxAwb);
  const awbBackfilled = !hadAwb && !!nextAwb;
  const safePatch = {
    ...stockxPatch,
    stockxOrderNumber: stockxPatch.stockxOrderNumber ?? match.stockxOrderNumber,
  };

  await prisma.decathlonStockxMatch.update({
    where: { id: match.id },
    data: { ...safePatch, updatedAt: new Date() },
  });
  return { ok: true, awbBackfilled };
}

/**
 * Re-fetch StockX buy by the order number / chain+order id already stored on `DecathlonStockxMatch`
 * (e.g. after manual modal save). Updates AWB, ETAs, tracking, states, amounts — no catalog variant matching.
 */
export async function refreshDecathlonStockxMatchesBySavedOrderNumber(
  token: string,
  orderDbId: string
): Promise<DecathlonOrderNumberRefreshStats> {
  const matches = await prisma.decathlonStockxMatch.findMany({
    where: { decathlonOrderId: orderDbId },
  });
  const eligibleList = matches.filter(decathlonMatchEligibleForOrderNumberRefresh);
  const skipped = matches.length - eligibleList.length;

  const stats: DecathlonOrderNumberRefreshStats = {
    eligible: eligibleList.length,
    attempted: 0,
    refreshed: 0,
    awbBackfilled: 0,
    failed: 0,
    skipped,
    failures: [],
  };

  if (eligibleList.length === 0) return stats;

  const limiter = createLimiter(4);
  await Promise.all(
    eligibleList.map((match) =>
      limiter(async () => {
        stats.attempted += 1;
        const result = await refreshOneMatch(token, match);
        if (result.ok) {
          stats.refreshed += 1;
          if (result.awbBackfilled) stats.awbBackfilled += 1;
        } else {
          stats.failed += 1;
          if (stats.failures.length < 20) {
            stats.failures.push({
              matchId: match.id,
              lineId: match.decathlonOrderLineId,
              reason: result.reason,
            });
          }
        }
      })
    )
  );

  return stats;
}
