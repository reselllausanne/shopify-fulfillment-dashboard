/**
 * Real StockX inbound sync — pulls the current StockX buying queue via the
 * StockX GraphQL API for every dashboard/db-side StockX account, resolves the
 * AWB per buy via `fetchStockxBuyOrderDetailsFull`, then upserts one
 * `StockxInboundPackage` row per AWB. Galaxus-side StockX accounts are skipped
 * on purpose — those AWBs belong to warehouse inbound flows, not Shopify AWB
 * fallback.
 *
 * Retention uses observed logistics stockxEventAt only:
 * delivered → shipped → tracking event → confirming StockX state timestamp.
 * Else firstSeenAt. Never ETA, sellerShipBy, purchaseDate, creationDate, or cron.
 * Never uses OrderMatch as an inbound source.
 */

import { prisma } from "@/app/lib/prisma";
import { createLimiter } from "@/galaxus/jobs/bulkSql";
import {
  fetchRecentStockxBuyingOrders,
  fetchStockxBuyOrderDetailsFull,
  type StockxBuyingNode,
} from "@/galaxus/stx/stockxClient";
import {
  listStockxAccountTokens,
  type StockxAccountToken,
} from "@/lib/stockxToken";
import {
  STOCKX_INBOUND_PACKAGE_RETENTION,
  emptyLogisticsDateSourceCounts,
  extractStockxInboundLogisticsAt,
  pruneStockxInboundPackagesForAccount,
  upsertStockxInboundPackage,
  type LogisticsDateSourceCounts,
} from "@/app/lib/stockxInboundPackages";

export type ShopifyStockxAccountResolution = {
  token: StockxAccountToken;
  accountKey: string;
};

/**
 * Choose the StockX account token that belongs to the Shopify side (dashboard
 * / DB rows). We deliberately SKIP `source === "galaxus"` — the Galaxus
 * StockX account funds warehouse pairs, not Shopify direct-ship, and its AWBs
 * must not appear in the Shopify AWB fallback pool.
 */
export async function resolveShopifyStockxAccountToken(): Promise<
  ShopifyStockxAccountResolution[]
> {
  const all = await listStockxAccountTokens();
  const filtered = all.filter((t) => t.source !== "galaxus");
  const preferredOrder: Array<StockxAccountToken["source"]> = ["dashboard", "db"];
  filtered.sort((a, b) => {
    const ai = preferredOrder.indexOf(a.source);
    const bi = preferredOrder.indexOf(b.source);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  return filtered.map((token) => ({
    token,
    accountKey: token.customerUuid || `shopify:${token.source}`,
  }));
}

type NodeSku = {
  sku: string | null;
  sizeEU: string | null;
  productName: string | null;
};

function extractSkuFromNode(node: StockxBuyingNode): NodeSku {
  const pv = (node.productVariant ?? {}) as any;
  const product = pv?.product ?? {};
  const sku: string | null =
    (typeof pv?.styleId === "string" && pv.styleId.trim()) ||
    (typeof product?.styleId === "string" && product.styleId.trim()) ||
    (typeof product?.urlKey === "string" && product.urlKey.trim()) ||
    null;
  const sizeEU: string | null =
    (typeof pv?.traits?.size === "string" && pv.traits.size.trim()) ||
    (typeof node?.localizedSizeTitle === "string" && node.localizedSizeTitle.trim()) ||
    null;
  const productName: string | null =
    (typeof product?.title === "string" && product.title.trim()) ||
    (typeof pv?.title === "string" && pv.title.trim()) ||
    null;
  return { sku, sizeEU, productName };
}

export type SyncStockxInboundOptions = {
  /** Retain at most this many rows per accountKey (default 100). */
  limitPerAccount?: number;
  /** How many buying-list pages per state to walk. */
  maxPages?: number;
  /** Concurrency for fetching AWB details. */
  concurrency?: number;
};

export type SyncStockxInboundResult = {
  ok: true;
  accounts: number;
  fetched: number;
  awbResolved: number;
  awbMissing: number;
  kept: number;
  pruned: number;
  firstSeen: number;
  refreshed: number;
  /** Rows upserted with a real observed logistics stockxEventAt. */
  withLogisticsEventAt: number;
  /** Rows ranked via firstSeenAt because no real logistics event exists. */
  fallbackFirstSeenAt: number;
  /** Alias of fallbackFirstSeenAt. */
  missingLogisticsEventAt: number;
  logisticsDateSources: LogisticsDateSourceCounts;
  /** @deprecated alias of firstSeen + refreshed */
  upserted: number;
  perAccount: Array<{
    accountKey: string;
    source: StockxAccountToken["source"];
    fetched: number;
    awbResolved: number;
    awbMissing: number;
    firstSeen: number;
    refreshed: number;
    upserted: number;
    pruned: number;
    kept: number;
    withLogisticsEventAt: number;
    fallbackFirstSeenAt: number;
    missingLogisticsEventAt: number;
    logisticsDateSources: LogisticsDateSourceCounts;
  }>;
};

/**
 * Pull PENDING + HISTORICAL buying orders per Shopify-side StockX account,
 * resolve AWBs, and upsert `StockxInboundPackage`. Keeps only the last N rows
 * per account by observed logistics stockxEventAt / firstSeenAt (default 100).
 */
export async function syncStockxInboundPackagesFromStockxApi(
  options: SyncStockxInboundOptions = {}
): Promise<SyncStockxInboundResult> {
  const limitPerAccount = Math.max(
    1,
    Math.min(500, options.limitPerAccount ?? STOCKX_INBOUND_PACKAGE_RETENTION)
  );
  const maxPages = Math.max(1, options.maxPages ?? 4);
  const concurrency = Math.max(1, options.concurrency ?? 2);

  const prismaAny = prisma as any;
  const accounts = await resolveShopifyStockxAccountToken();

  const perAccount: SyncStockxInboundResult["perAccount"] = [];
  let totalFetched = 0;
  let totalAwbResolved = 0;
  let totalAwbMissing = 0;
  let totalPruned = 0;
  let totalFirstSeen = 0;
  let totalRefreshed = 0;
  let totalKept = 0;
  let totalWithLogistics = 0;
  let totalFallbackFirstSeen = 0;
  const totalLogisticsSources = emptyLogisticsDateSourceCounts();

  for (const { token, accountKey } of accounts) {
    const nodes: StockxBuyingNode[] = [];
    for (const state of ["PENDING", "HISTORICAL"] as const) {
      try {
        const batch = await fetchRecentStockxBuyingOrders(token.token, {
          first: 100,
          maxPages,
          state,
        });
        nodes.push(...batch);
      } catch (err: any) {
        console.error(
          "[STOCKX-INBOUND-SYNC] fetch buying failed",
          { accountKey, state, error: err?.message || String(err) }
        );
      }
    }

    // Dedup by chainId::orderId (StockX pagination sometimes overlaps).
    const dedup = new Map<string, StockxBuyingNode>();
    for (const n of nodes) {
      const k = `${String(n.chainId ?? "")}::${String(n.orderId ?? "")}`;
      if (!k || k === "::") continue;
      if (!dedup.has(k)) dedup.set(k, n);
    }
    const uniqueNodes = Array.from(dedup.values());
    totalFetched += uniqueNodes.length;

    const limiter = createLimiter(concurrency);
    let acctAwbResolved = 0;
    let acctAwbMissing = 0;
    let acctFirstSeen = 0;
    let acctRefreshed = 0;
    let acctWithLogistics = 0;
    let acctFallbackFirstSeen = 0;
    const acctLogisticsSources = emptyLogisticsDateSourceCounts();

    await Promise.all(
      uniqueNodes.map((node) =>
        limiter(async () => {
          const chainId = String(node.chainId ?? "").trim();
          const orderId = String(node.orderId ?? "").trim();
          if (!chainId || !orderId) return;

          let awb: string | null = null;
          let detailOrder: any = null;
          try {
            const details = await fetchStockxBuyOrderDetailsFull(token.token, {
              chainId,
              orderId,
            });
            awb = details.awb;
            detailOrder = details.order;
          } catch (err: any) {
            console.warn(
              "[STOCKX-INBOUND-SYNC] detail fetch failed",
              { accountKey, chainId, orderId, error: err?.message || String(err) }
            );
          }

          if (!awb) {
            acctAwbMissing += 1;
            return;
          }

          const { sku, sizeEU, productName } = extractSkuFromNode(node);
          const status =
            (node.state?.statusKey as string | null | undefined) ??
            (node.state?.statusTitle as string | null | undefined) ??
            null;
          const purchaseDate = node.purchaseDate ?? node.creationDate ?? null;
          // Observed logistics only — ETA / sellerShipBy / purchaseDate never set stockxEventAt.
          const logistics = extractStockxInboundLogisticsAt({
            detailOrder,
            listNode: node,
          });
          const stockxEventAt = logistics.stockxEventAt;

          try {
            const row = await upsertStockxInboundPackage({
              awb,
              stockxOrderNumber: node.orderNumber ?? null,
              stockxOrderId: orderId,
              stockxAccountKey: accountKey,
              sku,
              sizeEU,
              productName,
              purchaseDate,
              stockxEventAt,
              status,
              channelHint: "shopify",
            });
            acctAwbResolved += 1;
            if (row?.created) acctFirstSeen += 1;
            else if (row) acctRefreshed += 1;
            acctLogisticsSources[logistics.source] += 1;
            if (stockxEventAt) acctWithLogistics += 1;
            else acctFallbackFirstSeen += 1;
          } catch (err: any) {
            console.error(
              "[STOCKX-INBOUND-SYNC] upsert failed",
              { accountKey, awb, error: err?.message || String(err) }
            );
          }
        })
      )
    );

    const acctPruned = await pruneStockxInboundPackagesForAccount({
      accountKey,
      limit: limitPerAccount,
    });

    let acctKept = 0;
    if (prismaAny.stockxInboundPackage) {
      acctKept = await prismaAny.stockxInboundPackage.count({
        where: { stockxAccountKey: accountKey },
      });
    }

    perAccount.push({
      accountKey,
      source: token.source,
      fetched: uniqueNodes.length,
      awbResolved: acctAwbResolved,
      awbMissing: acctAwbMissing,
      firstSeen: acctFirstSeen,
      refreshed: acctRefreshed,
      upserted: acctFirstSeen + acctRefreshed,
      pruned: acctPruned,
      kept: acctKept,
      withLogisticsEventAt: acctWithLogistics,
      fallbackFirstSeenAt: acctFallbackFirstSeen,
      missingLogisticsEventAt: acctFallbackFirstSeen,
      logisticsDateSources: { ...acctLogisticsSources },
    });
    totalAwbResolved += acctAwbResolved;
    totalAwbMissing += acctAwbMissing;
    totalPruned += acctPruned;
    totalFirstSeen += acctFirstSeen;
    totalRefreshed += acctRefreshed;
    totalKept += acctKept;
    totalWithLogistics += acctWithLogistics;
    totalFallbackFirstSeen += acctFallbackFirstSeen;
    for (const k of Object.keys(
      acctLogisticsSources
    ) as Array<keyof LogisticsDateSourceCounts>) {
      totalLogisticsSources[k] += acctLogisticsSources[k];
    }
  }

  return {
    ok: true,
    accounts: accounts.length,
    fetched: totalFetched,
    awbResolved: totalAwbResolved,
    awbMissing: totalAwbMissing,
    kept: totalKept,
    pruned: totalPruned,
    firstSeen: totalFirstSeen,
    refreshed: totalRefreshed,
    withLogisticsEventAt: totalWithLogistics,
    fallbackFirstSeenAt: totalFallbackFirstSeen,
    missingLogisticsEventAt: totalFallbackFirstSeen,
    logisticsDateSources: totalLogisticsSources,
    upserted: totalFirstSeen + totalRefreshed,
    perAccount,
  };
}
