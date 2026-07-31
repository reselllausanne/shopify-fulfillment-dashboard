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
} from "@/galaxus/stx/stockxClient";
import {
  getStxLinkStatusForOrder,
  linkOldestPendingStxUnit,
  resolveGalaxusOrderByIdOrRef,
  resolveSupplierVariantIdForGalaxusLine,
  reserveStxPurchaseUnitsForOrder,
} from "@/galaxus/stx/purchaseUnits";
import {
  galaxusLineWarehouseStockHint,
  isGalaxusStxSupplierLine,
} from "@/galaxus/warehouse/lineInventorySource";
import { readGalaxusStockxToken } from "@/lib/stockxGalaxusAuth";

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
};

export function filterGalaxusLinesNeedingStockxAutoLink(
  lines: any[],
  matchByLineId: Map<string, { stockxOrderNumber?: string | null }>
) {
  return (lines ?? []).filter((line) => {
    if (!isGalaxusStxSupplierLine(line) || galaxusLineWarehouseStockHint(line)) return false;
    const m = matchByLineId.get(String(line.id));
    if (m && String(m.stockxOrderNumber ?? "").trim()) return false;
    return true;
  });
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
  const matchByLineId = new Map<string, any>();
  for (const m of existingMatches) {
    matchByLineId.set(String(m.galaxusOrderLineId), m);
  }

  const linesToLink = filterGalaxusLinesNeedingStockxAutoLink(order.lines ?? [], matchByLineId);
  if (linesToLink.length === 0) {
    return { linked: 0, reason: "nothing_to_link" as const };
  }

  const token = await readGalaxusStockxToken();
  if (!token) return { linked: 0, reason: "no_token" as const };

  if (!options?.skipReserve) {
    await reserveStxPurchaseUnitsForOrder(order.galaxusOrderId);
  }
  const status = await getStxLinkStatusForOrder(order.galaxusOrderId);
  const needsLink = status.buckets.some((b) => b.linked < b.needed);
  if (!needsLink) {
    return { linked: 0, reason: "nothing_to_link" as const };
  }

  const buyingOrders = await fetchRecentStockxBuyingOrders(token, {
    first: 100,
    maxPages: 12,
    state: null,
  });

  const claimIndex = await buildStockxOrderClaimIndex({
    stockxOrderIds: buyingOrders.map((o) => o.orderId),
    stockxOrderNumbers: buyingOrders.map((o) => o.orderNumber),
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
      .filter((node) => {
        const vid = extractStockxVariantId(node, null);
        if (!vid || vid !== variantId) return false;
        return !findStockxOrderClaim(claimIndex, node.orderId, node.orderNumber);
      })
      .map((node) => ({
        node,
        timeDiff: computeTimeDiffHours(
          orderDateIso,
          node.purchaseDate ?? node.creationDate ?? null
        ),
      }))
      .filter((c) => c.timeDiff != null)
      .sort((a, b) => (a.timeDiff ?? 0) - (b.timeDiff ?? 0));

    let unitIndex = 0;
    for (const { node } of candidates) {
      if (unitIndex >= qty) break;

      const existingForUnit = existingMatches.find(
        (m: any) =>
          String(m.galaxusOrderLineId) === String(line.id) &&
          Number(m.unitIndex ?? 0) === unitIndex &&
          String(m.stockxOrderNumber ?? "").trim()
      );
      if (existingForUnit) {
        unitIndex += 1;
        continue;
      }

      const chainId = String(node.chainId ?? "").trim();
      const buyOrderId = String(node.orderId ?? "").trim();
      if (!chainId || !buyOrderId) continue;

      let details: Awaited<ReturnType<typeof fetchStockxBuyOrderDetailsFull>> | null = null;
      try {
        details = await fetchStockxBuyOrderDetailsFull(token, { chainId, orderId: buyOrderId });
      } catch {
        continue;
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

      if (linkResult.status !== "linked" && linkResult.status !== "already_linked") {
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

      linked += 1;
      unitIndex += 1;
    }
  }

  return { linked, reason: linked > 0 ? ("linked" as const) : ("no_candidates" as const) };
}
