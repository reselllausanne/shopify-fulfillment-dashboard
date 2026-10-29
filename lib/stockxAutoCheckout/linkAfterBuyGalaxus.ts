import { prisma } from "@/app/lib/prisma";
import { reconcileGalaxusOrderProcurement } from "@/galaxus/orders/galaxusProcurementReconcile";
import {
  linkOldestPendingStxUnit,
  reserveStxPurchaseUnitsForOrder,
  resolveSupplierVariantIdForGalaxusLine,
} from "@/galaxus/stx/purchaseUnits";
import type { StockxDesiredLane } from "@/lib/stockxAutoCheckout/types";

export type LinkGalaxusAfterBuyInput = {
  galaxusOrderDbId: string;
  galaxusOrderId: string;
  lineId: string;
  unitIndex?: number;
  productName: string;
  gtin?: string | null;
  sizeEU?: string | null;
  styleId?: string | null;
  sellChf: number;
  stockxOrderNumber: string;
  supplierCost: number;
  desiredLane: StockxDesiredLane;
  stockxCheckoutType?: string | null;
  estimatedDelivery?: string | Date | null;
};

/**
 * Post-buy link for Galaxus (mirrors manual-entry durable path):
 * GalaxusStockxMatch upsert + StxPurchaseUnit reserve/link + procurement reconcile.
 */
export async function linkStockxBuyToGalaxus(input: LinkGalaxusAfterBuyInput): Promise<{
  ok: boolean;
  matchId: string | null;
  unitLinkStatus: string | null;
  error: string | null;
}> {
  const stockxOrderNumber = String(input.stockxOrderNumber || "").trim();
  const lineId = String(input.lineId || "").trim();
  if (!stockxOrderNumber || !lineId) {
    return { ok: false, matchId: null, unitLinkStatus: null, error: "Missing ids" };
  }

  const unitIndex = Math.max(0, Number(input.unitIndex ?? 0) || 0);
  const checkoutType =
    input.stockxCheckoutType ||
    (input.desiredLane === "EXPRESS" ? "EXPRESS" : "STANDARD");
  const cost = Number(input.supplierCost) || 0;
  const sell = Number(input.sellChf) || 0;

  const order = await prisma.galaxusOrder.findFirst({
    where: {
      OR: [{ id: input.galaxusOrderDbId }, { galaxusOrderId: input.galaxusOrderId }],
    },
    include: { lines: true },
  });
  if (!order) {
    return { ok: false, matchId: null, unitLinkStatus: null, error: "Order not found" };
  }
  const line = (order.lines || []).find((l) => l.id === lineId);
  if (!line) {
    return { ok: false, matchId: null, unitLinkStatus: null, error: "Line not found" };
  }

  const prismaAny = prisma as any;
  const existingOther = await prismaAny.galaxusStockxMatch.findFirst({
    where: {
      stockxOrderNumber,
      NOT: { galaxusOrderLineId: lineId },
    },
    select: { galaxusOrderId: true, galaxusOrderLineId: true },
  });
  if (existingOther) {
    return {
      ok: false,
      matchId: null,
      unitLinkStatus: null,
      error: `StockX ${stockxOrderNumber} already on another Galaxus line`,
    };
  }

  const eta =
    input.estimatedDelivery instanceof Date
      ? input.estimatedDelivery
      : input.estimatedDelivery
        ? new Date(input.estimatedDelivery)
        : null;
  const etaOk = eta && !Number.isNaN(eta.getTime()) ? eta : null;

  const payload = {
    galaxusOrderId: order.id,
    galaxusOrderRef: order.galaxusOrderId ?? null,
    galaxusOrderDate: order.orderDate ?? null,
    galaxusOrderLineId: line.id,
    unitIndex,
    galaxusLineNumber: line.lineNumber ?? null,
    galaxusProductName: input.productName || line.productName || "Item",
    galaxusDescription: line.description ?? null,
    galaxusSize: input.sizeEU ?? line.size ?? null,
    galaxusGtin: input.gtin ?? line.gtin ?? null,
    galaxusProviderKey: line.providerKey ?? null,
    galaxusSupplierSku: line.supplierSku ?? null,
    galaxusQuantity: Number(line.quantity ?? 0),
    galaxusUnitNetPrice: line.unitNetPrice,
    galaxusLineNetAmount: line.lineNetAmount,
    galaxusVatRate: line.vatRate,
    galaxusCurrencyCode: order.currencyCode ?? "CHF",
    stockxOrderNumber,
    stockxOrderId: stockxOrderNumber,
    stockxProductName: input.productName || line.productName || null,
    stockxSkuKey: input.styleId ?? line.supplierSku ?? null,
    stockxSizeEU: input.sizeEU ?? line.size ?? null,
    stockxPurchaseDate: new Date(),
    stockxAmount: cost,
    stockxCurrencyCode: String(order.currencyCode ?? "CHF"),
    stockxStatus: "ORDERED",
    stockxEstimatedDelivery: etaOk,
    stockxLatestEstimatedDelivery: etaOk,
    stockxCheckoutType: checkoutType,
    matchConfidence: "auto_checkout",
    matchScore: 100,
    matchType: "STOCKX_AUTO_CHECKOUT",
    matchReasons: JSON.stringify([
      "stockx_auto_checkout_galaxus",
      `lane:${input.desiredLane}`,
      `sell:${sell}`,
    ]),
    updatedAt: new Date(),
  };

  const match = await prismaAny.galaxusStockxMatch.upsert({
    where: { galaxusOrderLineId_unitIndex: { galaxusOrderLineId: line.id, unitIndex } },
    update: payload,
    create: payload,
    select: { id: true },
  });

  let unitLinkStatus: string | null = null;
  try {
    await reserveStxPurchaseUnitsForOrder(order.galaxusOrderId);
    const supplierVariantId = await resolveSupplierVariantIdForGalaxusLine(line);
    if (supplierVariantId) {
      const unitLink = await linkOldestPendingStxUnit({
        galaxusOrderId: order.galaxusOrderId,
        supplierVariantId,
        gtin: line.gtin,
        stockxOrderId: stockxOrderNumber,
        stockxOrderNumber,
        etaMin: etaOk,
        etaMax: etaOk,
        checkoutType,
        stockxSettledAmount: cost,
        stockxSettledCurrency: payload.stockxCurrencyCode,
        allowMissingEta: true,
      });
      unitLinkStatus = String((unitLink as any)?.status ?? "unknown");
    } else {
      unitLinkStatus = "no_supplier_variant";
    }
  } catch (e: any) {
    unitLinkStatus = `unit_link_error:${e?.message || e}`;
  }

  await reconcileGalaxusOrderProcurement(order.galaxusOrderId, {
    skipAutoLink: true,
  }).catch((err) => {
    console.warn(
      "[GALAXUS][STX][AUTO] procurement reconcile skipped:",
      err?.message ?? err
    );
  });

  return { ok: true, matchId: match.id, unitLinkStatus, error: null };
}
