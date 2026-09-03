import { prisma } from "@/app/lib/prisma";
import {
  buildStockxOrderClaimIndex,
  findStockxOrderClaim,
  registerStockxOrderClaim,
} from "@/app/lib/stockxCrossChannelClaims";
import { applyStockxDetailsToDecathlonMatchFields } from "@/decathlon/stx/manualStockxEnrich";
import {
  extractStockxVariantId,
  fetchRecentStockxBuyingOrders,
  fetchStockxBuyOrderDetailsFull,
  synthesizeBuyOrderDetailsFromListNode,
} from "@/galaxus/stx/stockxClient";
import {
  getStxLinkStatusForOrder,
  linkOldestPendingStxUnit,
  resolveGalaxusOrderByIdOrRef,
  resolveSupplierVariantIdForGalaxusLine,
  reserveStxPurchaseUnitsForOrder,
  shouldWriteGalaxusMatchForLinkResult,
} from "@/galaxus/stx/purchaseUnits";
import {
  galaxusLineWarehouseStockHint,
  isGalaxusStxSupplierLine,
} from "@/galaxus/warehouse/lineInventorySource";
import {
  listStockxAccountTokens,
  resolveStockxBearerToken,
} from "@/lib/stockxToken";

function parseDateMs(value: unknown): number | null {
  if (!value) return null;
  const time = new Date(String(value)).getTime();
  return Number.isNaN(time) ? null : time;
}

function computeTimeDiffHours(orderDate: unknown, purchaseDate: unknown): number | null {
  const orderMs = parseDateMs(orderDate);
  const purchaseMs = parseDateMs(purchaseDate);
  if (orderMs == null || purchaseMs == null) return null;
  return Math.abs((purchaseMs - orderMs) / (1000 * 60 * 60));
}

export type AutoLinkGalaxusStockxBuysOptions = {
  /** Caller already ran reserve (e.g. procurement reconcile). */
  skipReserve?: boolean;
  /**
   * Prefetched StockX buys (with the bearer that owns them).
   * Bulk runners fetch PENDING+HISTORICAL once and pass this to avoid
   * hammering StockX once per Galaxus order.
   */
  prefetchedBuys?: Array<{
    node: Awaited<ReturnType<typeof fetchRecentStockxBuyingOrders>>[number];
    token: string;
  }>;
};

export function filterGalaxusLinesNeedingStockxAutoLink(
  lines: any[],
  matches: Array<{ galaxusOrderLineId?: unknown; stockxOrderNumber?: string | null }>
) {
  return (lines ?? []).filter((line) => {
    if (!isGalaxusStxSupplierLine(line) || galaxusLineWarehouseStockHint(line)) return false;
    const qty = Math.max(1, Math.round(Number(line.quantity ?? 1)));
    const linked = (matches ?? []).filter(
      (m) =>
        String(m.galaxusOrderLineId ?? "") === String(line.id) &&
        String(m.stockxOrderNumber ?? "").trim()
    ).length;
    return linked < qty;
  });
}

export function nextUnlinkedUnitIndex(
  lineId: string,
  qty: number,
  matches: Array<{ galaxusOrderLineId?: unknown; unitIndex?: unknown; stockxOrderNumber?: string | null }>,
  startFrom = 0
): number | null {
  for (let unitIndex = startFrom; unitIndex < qty; unitIndex++) {
    const taken = (matches ?? []).some(
      (m) =>
        String(m.galaxusOrderLineId ?? "") === String(lineId) &&
        Number(m.unitIndex ?? 0) === unitIndex &&
        String(m.stockxOrderNumber ?? "").trim()
    );
    if (!taken) return unitIndex;
  }
  return null;
}

/** Assign unclaimed StockX buys to pending units on this Galaxus order (FIFO by purchase time vs order date). */
export async function autoLinkUnclaimedStockxBuysForGalaxusOrder(
  orderIdOrRef: string,
  options?: AutoLinkGalaxusStockxBuysOptions
) {
  const order = await resolveGalaxusOrderByIdOrRef(orderIdOrRef);
  if (!order) return { linked: 0, reason: "not_found" as const };

  const prismaAny = prisma as any;
  const existingMatches = await prismaAny.galaxusStockxMatch.findMany({
    where: { galaxusOrderId: order.id },
  });

  const linesToLink = filterGalaxusLinesNeedingStockxAutoLink(order.lines ?? [], existingMatches);
  if (linesToLink.length === 0) {
    return { linked: 0, reason: "nothing_to_link" as const };
  }

  const auth = await resolveStockxBearerToken();
  const accountTokens = await listStockxAccountTokens();
  const tokens =
    accountTokens.length > 0
      ? accountTokens
      : auth
        ? [{ token: auth.token, source: auth.source, customerUuid: null }]
        : [];
  if (tokens.length === 0) return { linked: 0, reason: "no_token" as const };

  if (!options?.skipReserve) {
    await reserveStxPurchaseUnitsForOrder(order.galaxusOrderId);
  }
  const status = await getStxLinkStatusForOrder(order.galaxusOrderId);
  const needsLink = status.buckets.some((b) => b.linked < b.needed);
  if (!needsLink) {
    return { linked: 0, reason: "nothing_to_link" as const };
  }

  // StockX `state: null` returns 0 rows. Active buys live in PENDING.
  // Pull PENDING + HISTORICAL from every known StockX account (Galaxus + dashboard),
  // unless the caller already prefetched (bulk job).
  type BuyCandidate = {
    node: Awaited<ReturnType<typeof fetchRecentStockxBuyingOrders>>[number];
    token: string;
  };
  const buyingOrders: BuyCandidate[] = [];
  const seenBuy = new Set<string>();
  const pushBuy = (node: BuyCandidate["node"], token: string) => {
    const key = `${String(node.orderId ?? "").trim()}::${String(node.orderNumber ?? "").trim()}`;
    if (key === "::" || seenBuy.has(key)) return;
    seenBuy.add(key);
    buyingOrders.push({ node, token });
  };

  if (options?.prefetchedBuys?.length) {
    for (const row of options.prefetchedBuys) pushBuy(row.node, row.token);
  } else {
    for (const account of tokens) {
      const pending = await fetchRecentStockxBuyingOrders(account.token, {
        first: 100,
        maxPages: 8,
        state: "PENDING",
      }).catch((err: any) => {
        console.warn("[GALAXUS][STX][AUTO_LINK] PENDING list failed", {
          source: account.source,
          error: err?.message ?? err,
        });
        return [] as Awaited<ReturnType<typeof fetchRecentStockxBuyingOrders>>;
      });
      const historical = await fetchRecentStockxBuyingOrders(account.token, {
        first: 100,
        maxPages: 4,
        state: "HISTORICAL",
      }).catch((err: any) => {
        console.warn("[GALAXUS][STX][AUTO_LINK] HISTORICAL list failed", {
          source: account.source,
          error: err?.message ?? err,
        });
        return [] as Awaited<ReturnType<typeof fetchRecentStockxBuyingOrders>>;
      });
      for (const node of [...pending, ...historical]) pushBuy(node, account.token);
    }
  }

  const claimIndex = await buildStockxOrderClaimIndex({
    stockxOrderIds: buyingOrders.map((o) => o.node.orderId),
    stockxOrderNumbers: buyingOrders.map((o) => o.node.orderNumber),
  });

  const orderDateIso = order.orderDate
    ? new Date(order.orderDate).toISOString()
    : new Date().toISOString();
  let linked = 0;

  for (const line of linesToLink) {
    const qty = Math.max(1, Math.round(Number(line.quantity ?? 1)));
    const supplierVariantId = await resolveSupplierVariantIdForGalaxusLine(line);
    if (!supplierVariantId) continue;

    const variantId = supplierVariantId.replace(/^stx_/i, "");
    const candidates = buyingOrders
      .filter(({ node }) => {
        const vid = extractStockxVariantId(node, null);
        if (!vid || vid !== variantId) return false;
        return !findStockxOrderClaim(claimIndex, node.orderId, node.orderNumber);
      })
      .map(({ node, token }) => ({
        node,
        token,
        timeDiff: computeTimeDiffHours(
          orderDateIso,
          node.purchaseDate ?? node.creationDate ?? null
        ),
      }))
      .filter((c) => c.timeDiff != null)
      .sort((a, b) => (a.timeDiff ?? 0) - (b.timeDiff ?? 0));

    let searchFrom = 0;
    for (const { node, token } of candidates) {
      const unitIndex = nextUnlinkedUnitIndex(String(line.id), qty, existingMatches, searchFrom);
      if (unitIndex == null) break;

      const chainId = String(node.chainId ?? "").trim();
      const buyOrderId = String(node.orderId ?? "").trim();
      if (!chainId || !buyOrderId) continue;

      let details: Awaited<ReturnType<typeof fetchStockxBuyOrderDetailsFull>>;
      try {
        details = await fetchStockxBuyOrderDetailsFull(token, { chainId, orderId: buyOrderId });
        if (!details?.order) {
          details = synthesizeBuyOrderDetailsFromListNode(node);
        }
      } catch {
        // Same fallback as manual paste: Buying list amount/ETA when GET_BUY_ORDER WAF-blocks.
        details = synthesizeBuyOrderDetailsFromListNode(node);
      }

      const auto = applyStockxDetailsToDecathlonMatchFields(node, details, {
        matchReasons: ["AUTO_LINK_ON_FETCH"],
      });
      const stockxOrderNumber =
        String(auto.stockxOrderNumber ?? node.orderNumber ?? buyOrderId).trim() || buyOrderId;
      const stockxAmount =
        auto.stockxAmount != null && Number.isFinite(Number(auto.stockxAmount))
          ? Number(auto.stockxAmount)
          : null;

      const linkResult = await linkOldestPendingStxUnit({
        galaxusOrderId: order.galaxusOrderId,
        supplierVariantId,
        gtin: line.gtin,
        stockxOrderId: buyOrderId,
        stockxOrderNumber,
        awb: auto.stockxAwb,
        etaMin: auto.stockxEstimatedDelivery,
        etaMax: auto.stockxLatestEstimatedDelivery,
        stockxSettledAmount: stockxAmount,
        stockxSettledCurrency: auto.stockxCurrencyCode,
        allowMissingEta: true,
      });

      if (!shouldWriteGalaxusMatchForLinkResult(linkResult)) {
        // Includes `already_linked_other_order` — the StockX buy backs a unit
        // on a different Galaxus order. Writing a match here creates a stale
        // duplicate that /scan later treats as an auto-print target.
        if (linkResult.status === "already_linked_other_order") {
          console.warn("[GALAXUS][STX][AUTO_LINK] skipped cross-order duplicate", {
            stockxOrderId: buyOrderId,
            currentGalaxusOrderId: order.galaxusOrderId,
            otherGalaxusOrderId: (linkResult as any).otherGalaxusOrderId,
          });
        }
        continue;
      }

      // Belt-and-suspenders: refuse to write when a live match already exists
      // for this StockX buy on any other line/unit (covers legacy rows where
      // no StxPurchaseUnit was created).
      const conflictingMatch = await prismaAny.galaxusStockxMatch.findFirst({
        where: {
          OR: [
            ...(buyOrderId ? [{ stockxOrderId: buyOrderId }] : []),
            ...(stockxOrderNumber ? [{ stockxOrderNumber }] : []),
          ],
          NOT: {
            galaxusOrderLineId: line.id,
            unitIndex,
          },
        },
        select: { id: true, galaxusOrderRef: true, galaxusOrderLineId: true },
      });
      if (conflictingMatch) {
        console.warn("[GALAXUS][STX][AUTO_LINK] skipped duplicate match row", {
          stockxOrderId: buyOrderId,
          stockxOrderNumber,
          existingMatchId: conflictingMatch.id,
          existingOrderRef: conflictingMatch.galaxusOrderRef,
        });
        continue;
      }

      registerStockxOrderClaim(claimIndex, {
        channel: "galaxus",
        matchId: `${line.id}:${unitIndex}`,
        stockxOrderId: buyOrderId,
        stockxOrderNumber,
      });

      const payload = {
        galaxusOrderId: order.id,
        galaxusOrderRef: order.galaxusOrderId ?? null,
        galaxusOrderDate: order.orderDate ?? null,
        galaxusOrderLineId: line.id,
        unitIndex,
        galaxusLineNumber: line.lineNumber ?? null,
        galaxusProductName: line.productName ?? "Item",
        galaxusDescription: line.description ?? null,
        galaxusSize: line.size ?? null,
        galaxusGtin: line.gtin ?? null,
        galaxusProviderKey: line.providerKey ?? null,
        galaxusSupplierSku: line.supplierSku ?? null,
        galaxusQuantity: qty,
        galaxusUnitNetPrice: line.unitNetPrice,
        galaxusLineNetAmount: line.lineNetAmount,
        galaxusVatRate: line.vatRate,
        galaxusCurrencyCode: order.currencyCode ?? "CHF",
        stockxChainId: auto.stockxChainId,
        stockxOrderId: buyOrderId,
        stockxOrderNumber,
        stockxVariantId: auto.stockxVariantId,
        stockxProductName: auto.stockxProductName,
        stockxSkuKey: auto.stockxSkuKey,
        stockxSizeEU: auto.stockxSizeEU,
        stockxPurchaseDate: auto.stockxPurchaseDate,
        stockxAmount,
        stockxCurrencyCode: auto.stockxCurrencyCode,
        stockxStatus: auto.stockxStatus,
        stockxEstimatedDelivery: auto.stockxEstimatedDelivery,
        stockxLatestEstimatedDelivery: auto.stockxLatestEstimatedDelivery,
        stockxAwb: auto.stockxAwb,
        stockxTrackingUrl: auto.stockxTrackingUrl,
        stockxCheckoutType: auto.stockxCheckoutType,
        stockxStates: auto.stockxStates,
        matchConfidence: "high",
        matchScore: 1,
        matchType: "AUTO_LINK",
        matchReasons: JSON.stringify(["AUTO_LINK_ON_FETCH"]),
        timeDiffHours: computeTimeDiffHours(orderDateIso, node.purchaseDate ?? node.creationDate),
        updatedAt: new Date(),
      };

      await prismaAny.galaxusStockxMatch.upsert({
        where: {
          galaxusOrderLineId_unitIndex: { galaxusOrderLineId: line.id, unitIndex },
        },
        update: payload,
        create: payload,
      });
      existingMatches.push(payload);

      linked += 1;
      searchFrom = unitIndex + 1;
    }
  }

  return { linked, reason: linked > 0 ? ("linked" as const) : ("no_candidates" as const) };
}
