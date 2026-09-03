import { prisma } from "@/app/lib/prisma";
import { createLimiter } from "@/galaxus/jobs/bulkSql";
import { resolveStockxBuyByOrderNumberWithToken } from "@/decathlon/stx/manualStockxEnrich";
import { fetchStockxBuyOrderDetails } from "@/galaxus/stx/stockxClient";
import { listStockxAccountTokens, resolveStockxBearerToken } from "@/lib/stockxToken";

type StxAwbResyncResult = {
  scannedUnits: number;
  uniqueOrders: number;
  updatedUnits: number;
  updatedOrders: number;
  skippedReason?: "missing_token";
};

type StxAwbResyncOptions = {
  minAgeHours?: number;
  limitUnits?: number;
  concurrency?: number;
  /** Optional caller-provided bearer (hourly cron passes the freshly minted one). */
  token?: string;
  /**
   * Additional bearers (multi-account). When set, each order is retried across
   * all tokens until one returns a snapshot. Defaults to every account token
   * known to the server when neither `token` nor `tokens` is passed.
   */
  tokens?: string[];
};

/**
 * Backfill AWB on linked units that still have null AWB.
 * Uses stored order # / order id (all buying states) — not PENDING-only list.
 */
export async function runStxAwbResync(options: StxAwbResyncOptions = {}): Promise<StxAwbResyncResult> {
  const minAgeHours = Math.max(1, options.minAgeHours ?? 48);
  const limitUnits = Math.max(1, options.limitUnits ?? 500);
  const concurrency = Math.max(1, options.concurrency ?? 2);
  const cutoff = new Date(Date.now() - minAgeHours * 60 * 60 * 1000);

  // Prefer the caller-provided bearer (hourly cron already minted one), then
  // DB `StockXToken` (cron/dashboard refresh), then stale galaxus/dashboard
  // token files. Reading the stale galaxus file only was the root cause of
  // the orphaned-job invocation returning `missing_token` in practice.
  const tokenPool: string[] = [];
  const pushToken = (raw: string | null | undefined) => {
    const cleaned = String(raw ?? "").trim().replace(/^bearer\s+/i, "");
    if (cleaned && !tokenPool.includes(cleaned)) tokenPool.push(cleaned);
  };
  pushToken(options.token);
  for (const extra of options.tokens ?? []) pushToken(extra);
  if (tokenPool.length === 0) {
    const resolved = await resolveStockxBearerToken();
    pushToken(resolved?.token);
    // Multi-account: also enumerate every stored token so a Galaxus warehouse
    // AWB that lives on account B is filled even when the DB currently holds
    // account A's freshly minted bearer.
    const all = await listStockxAccountTokens();
    for (const entry of all) pushToken(entry.token);
  }
  if (tokenPool.length === 0) {
    return {
      scannedUnits: 0,
      uniqueOrders: 0,
      updatedUnits: 0,
      updatedOrders: 0,
      skippedReason: "missing_token",
    };
  }

  const pendingUnits = await (prisma as any).stxPurchaseUnit.findMany({
    where: {
      stockxOrderId: { not: null },
      awb: null,
      createdAt: { lte: cutoff },
    },
    orderBy: { createdAt: "asc" },
    take: limitUnits,
    select: { id: true, stockxOrderId: true, stockxOrderNumber: true },
  });

  const orderIds = Array.from(
    new Set<string>(
      pendingUnits
        .map((unit: any) => String(unit?.stockxOrderId ?? "").trim())
        .filter((value: string) => value.length > 0)
    )
  );
  if (orderIds.length === 0) {
    return {
      scannedUnits: pendingUnits.length,
      uniqueOrders: 0,
      updatedUnits: 0,
      updatedOrders: 0,
    };
  }

  const matches = await (prisma as any).galaxusStockxMatch.findMany({
    where: { stockxOrderId: { in: orderIds } },
    select: { stockxOrderId: true, stockxChainId: true },
  });
  const chainByOrderId = new Map<string, string>();
  for (const m of matches) {
    const oid = String(m?.stockxOrderId ?? "").trim();
    const chain = String(m?.stockxChainId ?? "").trim();
    if (oid && chain) chainByOrderId.set(oid, chain);
  }

  const unitByOrderId = new Map<string, { stockxOrderNumber: string | null }>();
  for (const unit of pendingUnits) {
    const oid = String(unit?.stockxOrderId ?? "").trim();
    if (!oid || unitByOrderId.has(oid)) continue;
    unitByOrderId.set(oid, {
      stockxOrderNumber:
        typeof unit?.stockxOrderNumber === "string" ? unit.stockxOrderNumber : null,
    });
  }

  const limiter = createLimiter(concurrency);
  let updatedUnits = 0;
  let updatedOrders = 0;

  await Promise.all(
    orderIds.map((stockxOrderId) =>
      limiter(async () => {
        let chainId = chainByOrderId.get(stockxOrderId) ?? "";
        let details: Awaited<ReturnType<typeof fetchStockxBuyOrderDetails>> | null = null;

        // Iterate all account tokens until one returns a snapshot. StockX
        // returns 404 for buys that don't belong to the calling account.
        for (const attemptToken of tokenPool) {
          if (chainId) {
            try {
              details = await fetchStockxBuyOrderDetails(attemptToken, {
                chainId,
                orderId: stockxOrderId,
              });
              if (details?.awb) break;
            } catch {
              details = null;
            }
          }
          if (!details?.awb) {
            const lookupKey =
              String(unitByOrderId.get(stockxOrderId)?.stockxOrderNumber ?? "").trim() ||
              stockxOrderId;
            const resolved = await resolveStockxBuyByOrderNumberWithToken(attemptToken, lookupKey);
            if (resolved.ok) {
              chainId = String(resolved.listNode.chainId ?? "").trim();
              details = {
                awb: resolved.details.awb,
                etaMin: resolved.details.etaMin,
                etaMax: resolved.details.etaMax,
                order: resolved.details.order,
              } as Awaited<ReturnType<typeof fetchStockxBuyOrderDetails>>;
              if (details.awb) break;
            }
          }
        }

        if (!details) return;

        const checkoutType =
          typeof details.order?.checkoutType === "string" ? details.order.checkoutType : null;
        const updateData: Record<string, unknown> = {
          etaMin: details.etaMin,
          etaMax: details.etaMax,
        };
        if (details.awb) updateData.awb = details.awb;
        if (checkoutType) updateData.checkoutType = checkoutType;

        const updateResult = await (prisma as any).stxPurchaseUnit.updateMany({
          where: {
            stockxOrderId,
            awb: null,
          },
          data: updateData,
        });
        if ((updateResult?.count ?? 0) > 0) {
          updatedOrders += 1;
          updatedUnits += updateResult.count;
        }
      })
    )
  );

  return {
    scannedUnits: pendingUnits.length,
    uniqueOrders: orderIds.length,
    updatedUnits,
    updatedOrders,
  };
}
