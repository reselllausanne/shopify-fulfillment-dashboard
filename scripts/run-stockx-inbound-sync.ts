#!/usr/bin/env npx tsx
/**
 * Manual StockX inbound sync against DATABASE_URL (staging validation).
 * Prints counters and writes per-AWB logisticsDateSource map for verify script.
 *
 * Usage:
 *   npx tsx scripts/run-stockx-inbound-sync.ts
 *   npx tsx scripts/run-stockx-inbound-sync.ts --limit 100 --maxPages 4
 */

import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/app/lib/prisma";
import { createLimiter } from "@/galaxus/jobs/bulkSql";
import {
  fetchRecentStockxBuyingOrders,
  fetchStockxBuyOrderDetailsFull,
  type StockxBuyingNode,
} from "@/galaxus/stx/stockxClient";
import {
  STOCKX_INBOUND_PACKAGE_RETENTION,
  emptyLogisticsDateSourceCounts,
  extractStockxInboundLogisticsAt,
  pruneStockxInboundPackagesForAccount,
  upsertStockxInboundPackage,
  type LogisticsDateSource,
} from "@/app/lib/stockxInboundPackages";
import { resolveShopifyStockxAccountToken } from "@/app/lib/stockxInboundSyncFromApi";

function argNum(flag: string, fallback: number): number {
  const i = process.argv.indexOf(flag);
  if (i < 0) return fallback;
  const n = Number(process.argv[i + 1]);
  return Number.isFinite(n) ? n : fallback;
}

function extractSku(node: StockxBuyingNode) {
  const pv = (node.productVariant ?? {}) as any;
  const product = pv?.product ?? {};
  const sku: string | null =
    (typeof pv?.styleId === "string" && pv.styleId.trim()) ||
    (typeof product?.styleId === "string" && product.styleId.trim()) ||
    (typeof product?.urlKey === "string" && product.urlKey.trim()) ||
    null;
  const sizeEU: string | null =
    (typeof pv?.traits?.size === "string" && pv.traits.size.trim()) ||
    (typeof node?.localizedSizeTitle === "string" &&
      node.localizedSizeTitle.trim()) ||
    null;
  const productName: string | null =
    (typeof product?.title === "string" && product.title.trim()) ||
    (typeof pv?.title === "string" && pv.title.trim()) ||
    null;
  return { sku, sizeEU, productName };
}

async function main() {
  const limitPerAccount = Math.max(
    1,
    Math.min(500, argNum("--limit", STOCKX_INBOUND_PACKAGE_RETENTION))
  );
  const maxPages = Math.max(1, argNum("--maxPages", 4));
  const concurrency = Math.max(1, argNum("--concurrency", 2));

  const accounts = await resolveShopifyStockxAccountToken();
  if (accounts.length === 0) {
    console.error("No Shopify-side StockX tokens found (db/dashboard).");
    process.exit(2);
  }

  console.log(
    JSON.stringify(
      {
        phase: "start",
        accounts: accounts.map((a) => ({
          accountKey: a.accountKey,
          source: a.token.source,
        })),
        limitPerAccount,
        maxPages,
        concurrency,
      },
      null,
      2
    )
  );

  const byAwb: Record<string, LogisticsDateSource> = {};
  const logisticsDateSources = emptyLogisticsDateSourceCounts();
  let fetched = 0;
  let awbResolved = 0;
  let awbMissing = 0;
  let firstSeen = 0;
  let refreshed = 0;
  let withLogisticsEventAt = 0;
  let fallbackFirstSeenAt = 0;
  let pruned = 0;
  const perAccount: any[] = [];

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
        console.error("[SYNC] buying fetch failed", {
          accountKey,
          state,
          error: err?.message || String(err),
        });
      }
    }

    const dedup = new Map<string, StockxBuyingNode>();
    for (const n of nodes) {
      const k = `${String(n.chainId ?? "")}::${String(n.orderId ?? "")}`;
      if (!k || k === "::") continue;
      if (!dedup.has(k)) dedup.set(k, n);
    }
    const uniqueNodes = Array.from(dedup.values());
    fetched += uniqueNodes.length;

    const limiter = createLimiter(concurrency);
    let acctAwbResolved = 0;
    let acctAwbMissing = 0;
    let acctFirstSeen = 0;
    let acctRefreshed = 0;
    let acctWith = 0;
    let acctFallback = 0;
    const acctSources = emptyLogisticsDateSourceCounts();

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
            console.warn("[SYNC] detail failed", {
              accountKey,
              chainId,
              orderId,
              error: err?.message || String(err),
            });
          }
          if (!awb) {
            acctAwbMissing += 1;
            return;
          }

          const { sku, sizeEU, productName } = extractSku(node);
          const status =
            (node.state?.statusKey as string | null | undefined) ??
            (node.state?.statusTitle as string | null | undefined) ??
            null;
          const purchaseDate = node.purchaseDate ?? node.creationDate ?? null;
          const logistics = extractStockxInboundLogisticsAt({
            detailOrder,
            listNode: node,
          });

          // Poison check: never allow purchaseDate to equal stockxEventAt via extract.
          if (
            logistics.stockxEventAt &&
            purchaseDate &&
            Math.abs(
              logistics.stockxEventAt.getTime() -
                new Date(purchaseDate).getTime()
            ) < 1000 &&
            logistics.source !== "delivered" &&
            logistics.source !== "shipped"
          ) {
            console.warn("[SYNC] refusing purchase-like event", {
              awb,
              purchaseDate,
              stockxEventAt: logistics.stockxEventAt.toISOString(),
              source: logistics.source,
            });
          }

          const row = await upsertStockxInboundPackage({
            awb,
            stockxOrderNumber: node.orderNumber ?? null,
            stockxOrderId: orderId,
            stockxAccountKey: accountKey,
            sku,
            sizeEU,
            productName,
            purchaseDate,
            stockxEventAt: logistics.stockxEventAt,
            status,
            channelHint: "shopify",
          });
          if (!row) return;

          const awbKey = String(awb).toUpperCase();
          byAwb[awbKey] = logistics.source;
          acctSources[logistics.source] += 1;
          logisticsDateSources[logistics.source] += 1;
          acctAwbResolved += 1;
          if (row.created) acctFirstSeen += 1;
          else acctRefreshed += 1;
          if (logistics.stockxEventAt) acctWith += 1;
          else acctFallback += 1;
        })
      )
    );

    const acctPruned = await pruneStockxInboundPackagesForAccount({
      accountKey,
      limit: limitPerAccount,
    });
    pruned += acctPruned;
    awbResolved += acctAwbResolved;
    awbMissing += acctAwbMissing;
    firstSeen += acctFirstSeen;
    refreshed += acctRefreshed;
    withLogisticsEventAt += acctWith;
    fallbackFirstSeenAt += acctFallback;

    perAccount.push({
      accountKey,
      source: token.source,
      fetched: uniqueNodes.length,
      awbResolved: acctAwbResolved,
      awbMissing: acctAwbMissing,
      firstSeen: acctFirstSeen,
      refreshed: acctRefreshed,
      pruned: acctPruned,
      withLogisticsEventAt: acctWith,
      fallbackFirstSeenAt: acctFallback,
      missingLogisticsEventAt: acctFallback,
      logisticsDateSources: acctSources,
    });
  }

  const kept = await (prisma as any).stockxInboundPackage.count();
  const result = {
    ok: true as const,
    accounts: accounts.length,
    fetched,
    awbResolved,
    awbMissing,
    kept,
    pruned,
    firstSeen,
    refreshed,
    withLogisticsEventAt,
    fallbackFirstSeenAt,
    missingLogisticsEventAt: fallbackFirstSeenAt,
    logisticsDateSources,
    perAccount,
  };

  const tmpDir = path.join(process.cwd(), "tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  const sourcesPath = path.join(tmpDir, "inbound-sync-last-sources.json");
  fs.writeFileSync(
    sourcesPath,
    JSON.stringify(
      { at: new Date().toISOString(), byAwb, result },
      null,
      2
    )
  );
  const reportPath = path.join(
    tmpDir,
    `inbound-sync-report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
  );
  fs.writeFileSync(reportPath, JSON.stringify(result, null, 2));

  console.log(JSON.stringify(result, null, 2));
  console.log(`[SYNC] wrote ${sourcesPath}`);
  console.log(`[SYNC] wrote ${reportPath}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => null);
  });
