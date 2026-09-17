/**
 * Real StockX inbound sync — pulls the current StockX buying queue via the
 * StockX GraphQL API for every dashboard/db-side StockX account, resolves the
 * AWB per buy via `fetchStockxBuyOrderDetailsFull`, then upserts one
 * `StockxInboundPackage` row per AWB. Galaxus-side StockX accounts are skipped
 * on purpose — those AWBs belong to warehouse inbound flows, not Shopify AWB
 * fallback.
 *
 * This replaces the old `syncStockxInboundPackagesFromDb` path, which just
 * copied AWBs already stored on OrderMatch / StxPurchaseUnit into
 * StockxInboundPackage and then handed them right back to the fallback — a
 * closed loop of fake signal.
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
  upsertStockxInboundPackage,
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
 *
 * Returns an ordered list so we can sync each real Shopify-side account.
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
  upserted: number;
  awbResolved: number;
  awbMissing: number;
  pruned: number;
  perAccount: Array<{
    accountKey: string;
    source: StockxAccountToken["source"];
    nodes: number;
    upserted: number;
    awbResolved: number;
    awbMissing: number;
    pruned: number;
  }>;
};

/**
 * Pull PENDING + HISTORICAL buying orders per Shopify-side StockX account,
 * resolve AWBs, and upsert `StockxInboundPackage`. Keeps only the last N rows
 * per account (default 100).
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
  let totalUpserted = 0;
  let totalAwbResolved = 0;
  let totalAwbMissing = 0;
  let totalPruned = 0;

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

    const limiter = createLimiter(concurrency);
    let acctUpserted = 0;
    let acctAwbResolved = 0;
    let acctAwbMissing = 0;

    await Promise.all(
      uniqueNodes.map((node) =>
        limiter(async () => {
          const chainId = String(node.chainId ?? "").trim();
          const orderId = String(node.orderId ?? "").trim();
          if (!chainId || !orderId) return;

          let awb: string | null = null;
          try {
            const details = await fetchStockxBuyOrderDetailsFull(token.token, {
              chainId,
              orderId,
            });
            awb = details.awb;
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

          try {
            await upsertStockxInboundPackage({
              awb,
              stockxOrderNumber: node.orderNumber ?? null,
              stockxOrderId: orderId,
              stockxAccountKey: accountKey,
              sku,
              sizeEU,
              productName,
              purchaseDate: node.purchaseDate ?? node.creationDate ?? null,
              status,
              arrivedAt: new Date(),
              channelHint: "shopify",
            });
            acctUpserted += 1;
            acctAwbResolved += 1;
          } catch (err: any) {
            console.error(
              "[STOCKX-INBOUND-SYNC] upsert failed",
              { accountKey, awb, error: err?.message || String(err) }
            );
          }
        })
      )
    );

    // Prune per accountKey to `limitPerAccount` most recent rows.
    let acctPruned = 0;
    if (prismaAny.stockxInboundPackage) {
      const keep = await prismaAny.stockxInboundPackage.findMany({
        where: { stockxAccountKey: accountKey },
        orderBy: { arrivedAt: "desc" },
        take: limitPerAccount,
        select: { id: true },
      });
      const keepIds = new Set(keep.map((r: { id: string }) => r.id));
      const prunedResult = await prismaAny.stockxInboundPackage.deleteMany({
        where: {
          stockxAccountKey: accountKey,
          id: { notIn: Array.from(keepIds) },
        },
      });
      acctPruned = Number(prunedResult?.count ?? 0);
    }

    perAccount.push({
      accountKey,
      source: token.source,
      nodes: uniqueNodes.length,
      upserted: acctUpserted,
      awbResolved: acctAwbResolved,
      awbMissing: acctAwbMissing,
      pruned: acctPruned,
    });
    totalUpserted += acctUpserted;
    totalAwbResolved += acctAwbResolved;
    totalAwbMissing += acctAwbMissing;
    totalPruned += acctPruned;
  }

  return {
    ok: true,
    accounts: accounts.length,
    upserted: totalUpserted,
    awbResolved: totalAwbResolved,
    awbMissing: totalAwbMissing,
    pruned: totalPruned,
    perAccount,
  };
}
