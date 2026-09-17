import { prisma } from "@/app/lib/prisma";
import { toShopifyCreatedAtStorage } from "@/app/utils/shopifySellDate";
import {
  isShopifyFinancialRefunded,
  matchShopifyToSupplier,
  type NormalizedSupplierOrder,
} from "@/app/utils/matching";
import { fetchGoatBuyOrders } from "@/app/lib/goat/fetchOrders";
import type { NormalizedGoatOrder } from "@/app/lib/goat/normalize";
import { fetchUnmatchedShopifyLines } from "@/shopify/orders/unmatchedShopifyLines";

export type AutoLinkGoatResult = {
  fetched: number;
  awbUpdated: number;
  linked: number;
  noCandidates: number;
  error?: string;
};

function goatToSupplier(order: NormalizedGoatOrder): NormalizedSupplierOrder {
  return {
    chainId: order.chainId || "",
    orderId: order.orderId,
    supplierOrderNumber: order.orderNumber,
    supplierSource: "OTHER",
    purchaseDate: order.purchaseDate || "",
    offerAmount: order.amount,
    totalTTC: order.supplierCost ?? order.amount,
    productTitle: order.productTitle || order.displayName,
    skuKey: order.skuKey,
    sizeEU: order.size,
    statusKey: order.statusKey,
    statusTitle: order.statusTitle,
    currencyCode: order.currencyCode,
    estimatedDeliveryDate: order.estimatedDeliveryDate,
    latestEstimatedDeliveryDate: order.latestEstimatedDeliveryDate,
    productVariantId: order.productVariantId ?? undefined,
    awb: order.awb,
    trackingUrl: order.trackingUrl,
  };
}

/** Refresh AWB/status on already-linked GOAT matches, then auto-link unmatched Shopify lines. */
export async function autoLinkGoatBuysForShopifyOrders(options?: {
  days?: number;
  limit?: number;
  apply?: boolean;
  cookie?: string | null;
  csrfToken?: string | null;
}): Promise<AutoLinkGoatResult> {
  const days = Math.min(365, Math.max(1, options?.days ?? 21));
  const limit = Math.max(1, options?.limit ?? 200);
  const apply = options?.apply !== false;

  const fetched = await fetchGoatBuyOrders({
    cookie: options?.cookie,
    csrfToken: options?.csrfToken,
    persist: true,
    maxPages: 10,
  });
  if (!fetched.ok) {
    return {
      fetched: fetched.orders.length,
      awbUpdated: 0,
      linked: 0,
      noCandidates: 0,
      error: fetched.error,
    };
  }

  const goatByNumber = new Map<string, NormalizedGoatOrder>();
  for (const order of fetched.orders) {
    goatByNumber.set(order.orderNumber, order);
    if (order.orderId) goatByNumber.set(order.orderId, order);
    goatByNumber.set(`GOAT-${order.orderId}`, order);
  }

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - (days - 1));
  const existingGoatMatches = await prisma.orderMatch.findMany({
    where: {
      shopifyCreatedAt: { gte: since },
      OR: [
        { stockxOrderNumber: { startsWith: "GOAT-" } },
        { stockxOrderNumber: { contains: "GOAT" } },
      ],
    },
    select: {
      id: true,
      stockxOrderNumber: true,
      stockxOrderId: true,
      stockxAwb: true,
      stockxTrackingUrl: true,
      stockxStatus: true,
    },
  });

  let awbUpdated = 0;
  if (apply) {
    for (const row of existingGoatMatches) {
      const goat =
        goatByNumber.get(String(row.stockxOrderNumber ?? "")) ||
        (row.stockxOrderId ? goatByNumber.get(String(row.stockxOrderId)) : null);
      if (!goat) continue;
      const nextAwb = String(goat.awb ?? "").trim();
      const nextUrl = String(goat.trackingUrl ?? "").trim();
      const nextStatus = String(goat.statusKey ?? "").trim();
      const changed =
        (nextAwb && nextAwb !== String(row.stockxAwb ?? "").trim()) ||
        (nextUrl && nextUrl !== String(row.stockxTrackingUrl ?? "").trim()) ||
        (nextStatus && nextStatus !== String(row.stockxStatus ?? "").trim());
      if (!changed) continue;
      await prisma.orderMatch.update({
        where: { id: row.id },
        data: {
          stockxAwb: nextAwb || row.stockxAwb,
          stockxTrackingUrl: nextUrl || row.stockxTrackingUrl,
          stockxStatus: nextStatus || row.stockxStatus,
        },
      });
      awbUpdated += 1;
    }
  }

  const shop = await fetchUnmatchedShopifyLines(days);
  const used = new Set<string>(
    existingGoatMatches.map((m) => String(m.stockxOrderNumber ?? "")).filter(Boolean)
  );
  const suppliers = fetched.orders.map(goatToSupplier);
  const sortedLines = [...shop.lines]
    .filter((line) => !isShopifyFinancialRefunded(line.displayFinancialStatus))
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  let linked = 0;
  let noCandidates = 0;
  for (const line of sortedLines) {
    if (linked >= limit) break;
    const result = matchShopifyToSupplier(line, suppliers, used, null);
    const best = result.bestMatch;
    if (!best || best.confidence !== "high") {
      if (!best) noCandidates += 1;
      continue;
    }
    const supplier = best.supplierOrder;
    used.add(supplier.supplierOrderNumber);
    if (!apply) {
      linked += 1;
      continue;
    }

    const revenue = Number(line.totalPrice) || 0;
    const supplierCost = Number(supplier.totalTTC ?? supplier.offerAmount ?? 0) || 0;
    const marginAmount = Number((revenue - supplierCost).toFixed(2));
    const marginPercent = revenue > 0 ? Number(((marginAmount / revenue) * 100).toFixed(2)) : 0;

    await prisma.orderMatch.upsert({
      where: { shopifyLineItemId: line.lineItemId },
      create: {
        shopifyOrderId: line.shopifyOrderId,
        shopifyOrderName: line.orderName,
        shopifyLineItemId: line.lineItemId,
        shopifyProductTitle: line.title,
        shopifySku: line.sku ?? null,
        shopifySizeEU: line.sizeEU ?? null,
        shopifyTotalPrice: revenue,
        shopifyCurrencyCode: line.currencyCode || "CHF",
        shopifyCreatedAt: toShopifyCreatedAtStorage(new Date(line.createdAt)),
        shopifyCustomerEmail: line.customerEmail ?? null,
        shopifyCustomerFirstName: line.customerFirstName ?? null,
        shopifyCustomerLastName: line.customerLastName ?? null,
        shopifyLineItemImageUrl: line.lineItemImageUrl ?? null,
        supplierSource: "OTHER",
        stockxOrderNumber: supplier.supplierOrderNumber,
        stockxOrderId: supplier.orderId || null,
        stockxProductName: supplier.productTitle || line.title,
        stockxSizeEU: supplier.sizeEU || line.sizeEU || null,
        stockxSkuKey: supplier.skuKey || line.sku || null,
        stockxPurchaseDate: supplier.purchaseDate ? new Date(supplier.purchaseDate) : null,
        matchConfidence: "high",
        matchScore: best.score,
        matchType: "AUTO_LINK_GOAT",
        matchReasons: JSON.stringify(best.reasons),
        timeDiffHours: best.timeDiffHours,
        stockxStatus: supplier.statusKey || "GOAT",
        stockxAwb: supplier.awb ?? null,
        stockxTrackingUrl: supplier.trackingUrl ?? null,
        supplierCost,
        marginAmount,
        marginPercent,
        shopifyMetafieldsSynced: false,
      },
      update: {
        supplierSource: "OTHER",
        stockxOrderNumber: supplier.supplierOrderNumber,
        stockxOrderId: supplier.orderId || undefined,
        stockxProductName: supplier.productTitle || undefined,
        stockxSizeEU: supplier.sizeEU || undefined,
        stockxSkuKey: supplier.skuKey || undefined,
        stockxPurchaseDate: supplier.purchaseDate ? new Date(supplier.purchaseDate) : undefined,
        matchConfidence: "high",
        matchScore: best.score,
        matchType: "AUTO_LINK_GOAT",
        matchReasons: JSON.stringify(best.reasons),
        timeDiffHours: best.timeDiffHours,
        stockxStatus: supplier.statusKey || undefined,
        stockxAwb: supplier.awb ?? undefined,
        stockxTrackingUrl: supplier.trackingUrl ?? undefined,
        supplierCost: supplierCost > 0 ? supplierCost : undefined,
        marginAmount,
        marginPercent,
      },
    });
    linked += 1;
  }

  return { fetched: fetched.orders.length, awbUpdated, linked, noCandidates };
}
