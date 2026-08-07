import { prisma } from "@/app/lib/prisma";
import { isGalaxusStxSupplierLine } from "@/galaxus/warehouse/lineInventorySource";
import {
  attachPhysicalStockToLines,
  buildPhysicalStockByGtinMap,
} from "@/shopify/inventory/orderLinePhysicalStock";

/** Stable ops ref for Galaxus lines fulfilled from local/physical stock (not a StockX buy). */
export function localStockMatchRef(galaxusOrderId: string, lineNumber: number | string | null | undefined): string {
  return `LOCAL-STOCK-${String(galaxusOrderId ?? "").trim()}-${String(lineNumber ?? "0").trim()}`;
}

export function isLocalOrManualStockxRef(value: unknown): boolean {
  const ref = String(value ?? "").trim();
  if (!ref) return false;
  return /^LOCAL-STOCK-/i.test(ref) || /^MANUAL-/i.test(ref);
}

export async function upsertGalaxusLocalStockMatch(params: {
  order: {
    id: string;
    galaxusOrderId: string;
    orderDate?: Date | null;
    currencyCode?: string | null;
  };
  line: {
    id: string;
    lineNumber?: number | null;
    productName?: string | null;
    description?: string | null;
    size?: string | null;
    gtin?: string | null;
    providerKey?: string | null;
    supplierSku?: string | null;
    quantity?: number | null;
    unitNetPrice?: unknown;
    lineNetAmount?: unknown;
    vatRate?: unknown;
  };
  /**
   * Local/physical warehouse stock is already expensed on the inventory side
   * (same rule as Shopify LOCAL ALREADY_EXPENSED). Galaxus match cost = 0 so
   * metrics do not double-count COGS. Explicit override only if caller passes one.
   */
  stockxAmount?: number | null;
  reason?: string;
}) {
  const prismaAny = prisma as any;
  const localRef = localStockMatchRef(params.order.galaxusOrderId, params.line.lineNumber);
  const amount =
    params.stockxAmount != null && Number.isFinite(Number(params.stockxAmount))
      ? Number(params.stockxAmount)
      : 0;
  const payload = {
    galaxusOrderId: params.order.id,
    galaxusOrderRef: params.order.galaxusOrderId ?? null,
    galaxusOrderDate: params.order.orderDate ?? null,
    galaxusOrderLineId: params.line.id,
    unitIndex: 0,
    galaxusLineNumber: params.line.lineNumber ?? null,
    galaxusProductName: params.line.productName ?? "Item",
    galaxusDescription: params.line.description ?? null,
    galaxusSize: params.line.size ?? null,
    galaxusGtin: params.line.gtin ?? null,
    galaxusProviderKey: params.line.providerKey ?? null,
    galaxusSupplierSku: params.line.supplierSku ?? null,
    galaxusQuantity: Math.max(1, Number(params.line.quantity ?? 1)),
    galaxusUnitNetPrice: params.line.unitNetPrice,
    galaxusLineNetAmount: params.line.lineNetAmount,
    galaxusVatRate: params.line.vatRate,
    galaxusCurrencyCode: params.order.currencyCode ?? "CHF",
    stockxOrderNumber: localRef,
    stockxStatus: "LOCAL_STOCK",
    stockxAmount: amount,
    stockxCurrencyCode: String(params.order.currencyCode ?? "CHF"),
    matchConfidence: "high",
    matchScore: 1,
    matchType: "LOCAL_STOCK",
    matchReasons: JSON.stringify([params.reason ?? "LOCAL_PHYSICAL_STOCK_RESERVED"]),
    updatedAt: new Date(),
  };
  return prismaAny.galaxusStockxMatch.upsert({
    where: { galaxusOrderLineId_unitIndex: { galaxusOrderLineId: params.line.id, unitIndex: 0 } },
    update: payload,
    create: payload,
  });
}

/**
 * Persist LOCAL_STOCK matches for STX lines that still have physical qty
 * (or were already warehouse-shipped without a match). Safe to call at ORDP ingest.
 */
export async function ensureLocalStockMatchesForOrder(params: {
  order: {
    id: string;
    galaxusOrderId: string;
    orderDate?: Date | null;
    currencyCode?: string | null;
    lines?: any[];
  };
  reason?: string;
}): Promise<{ created: number }> {
  const lines = params.order.lines ?? [];
  if (lines.length === 0) return { created: 0 };

  const prismaAny = prisma as any;
  const existing = await prismaAny.galaxusStockxMatch.findMany({
    where: { galaxusOrderId: params.order.id },
    select: { galaxusOrderLineId: true, stockxOrderNumber: true, matchType: true },
  });
  const hasMatchByLine = new Set(
    existing
      .filter((m: any) => String(m?.stockxOrderNumber ?? "").trim().length > 0)
      .map((m: any) => String(m.galaxusOrderLineId))
  );

  const physicalStockByGtin = await buildPhysicalStockByGtinMap(lines.map((l: any) => l?.gtin));
  const withPhysical = attachPhysicalStockToLines(lines, physicalStockByGtin);

  let created = 0;
  for (const line of withPhysical) {
    if (!isGalaxusStxSupplierLine(line)) continue;
    const lineId = String(line?.id ?? "").trim();
    if (!lineId || hasMatchByLine.has(lineId)) continue;

    const localQty = Number(line?.physicalStock?.qty ?? 0);
    const hasLiveStock = Number.isFinite(localQty) && localQty > 0;
    const alreadyShipped = Boolean(line?.warehouseMarkedShippedAt);
    if (!hasLiveStock && !alreadyShipped) continue;

    if (!hasLiveStock && alreadyShipped) {
      const gtin = String(line?.gtin ?? "").trim();
      const linkedUnit = gtin
        ? await prismaAny.stxPurchaseUnit
            .findFirst({
              where: {
                galaxusOrderId: params.order.galaxusOrderId,
                gtin,
                stockxOrderId: { not: null },
                cancelledAt: null,
              },
              select: { id: true },
            })
            .catch(() => null)
        : null;
      if (linkedUnit) continue;
    }

    await upsertGalaxusLocalStockMatch({
      order: params.order,
      line,
      stockxAmount: 0,
      reason:
        params.reason ??
        (alreadyShipped && !hasLiveStock
          ? "LOCAL_PHYSICAL_STOCK_AFTER_SHIP"
          : "LOCAL_PHYSICAL_STOCK_ON_INGEST"),
    });
    hasMatchByLine.add(lineId);
    created += 1;
  }

  return { created };
}
