import { prisma } from "@/app/lib/prisma";
import {
  computeShipmentCoverageForOrders,
  loadDelrShipmentIdsForOrders,
  loadShipmentItemsForOrders,
} from "@/galaxus/warehouse/shipmentLineCoverage";
import {
  decideFulfillUnitSelection,
  type FulfillOpenUnit,
  type UnitSelectionDecision,
} from "@/lib/shopifyFulfillUnitSelection";
import { isLocalOrManualStockxRef } from "@/galaxus/orders/localStockMatch";

export type GalaxusDirectProcurementInfo = {
  source: "stockx" | "external" | "local";
  supplier: string;
  unitIndex: number;
  reference: string | null;
  status: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  etaMin: string | null;
  etaMax: string | null;
};

export type GalaxusDirectOpenUnit = FulfillOpenUnit & {
  lineId: string;
  size: string | null;
  gtin: string | null;
  procurement: GalaxusDirectProcurementInfo[];
};

export type GalaxusDirectOpenUnitsResult = {
  openUnits: GalaxusDirectOpenUnit[];
  unitSelection: UnitSelectionDecision;
};

const text = (value: unknown): string | null => {
  const normalized = String(value ?? "").trim();
  return normalized || null;
};

export function latestStockxStep(states: unknown, fallback?: string | null): string | null {
  if (!Array.isArray(states)) return text(fallback);
  const rows = states.filter((row): row is Record<string, unknown> =>
    Boolean(row && typeof row === "object")
  );
  const completed = [...rows].reverse().find((row) => {
    const progress = String(row.progress ?? "").trim().toUpperCase();
    const status = String(row.status ?? "").trim().toUpperCase();
    return progress === "COMPLETED" || status === "SUCCESS";
  });
  const current =
    completed ??
    [...rows].reverse().find((row) =>
      Boolean(text(row.title) || text(row.subtitle) || text(row.status))
    );
  return (
    text(current?.title) ??
    text(current?.subtitle) ??
    text(current?.status) ??
    text(fallback)
  );
}

/**
 * Remaining shippable units on a Galaxus direct_delivery order (all lines).
 * `lineItemId` mirrors Shopify helper so decideFulfillUnitSelection applies.
 */
export async function listGalaxusDirectOpenUnits(params: {
  orderDbId: string;
  scannedLineId?: string | null;
}): Promise<GalaxusDirectOpenUnitsResult> {
  const orderDbId = String(params.orderDbId ?? "").trim();
  const scannedLineId = String(params.scannedLineId ?? "").trim() || null;
  if (!orderDbId) {
    return {
      openUnits: [],
      unitSelection: decideFulfillUnitSelection([]),
    };
  }

  const order = await prisma.galaxusOrder.findFirst({
    where: { OR: [{ id: orderDbId }, { galaxusOrderId: orderDbId }] },
    select: {
      id: true,
      galaxusOrderId: true,
      deliveryType: true,
      cancelledAt: true,
      archivedAt: true,
      lines: {
        orderBy: { lineNumber: "asc" },
        select: {
          id: true,
          lineNumber: true,
          productName: true,
          size: true,
          gtin: true,
          quantity: true,
          buyerPid: true,
          supplierPid: true,
          warehouseMarkedShippedAt: true,
          stockxMatches: {
            orderBy: { unitIndex: "asc" },
            select: {
              unitIndex: true,
              stockxOrderNumber: true,
              stockxStatus: true,
              stockxStates: true,
              stockxAwb: true,
              stockxTrackingUrl: true,
              stockxEstimatedDelivery: true,
              stockxLatestEstimatedDelivery: true,
              matchType: true,
            },
          },
          externalBuys: {
            where: { cancelledAt: null },
            orderBy: { unitIndex: "asc" },
            select: {
              unitIndex: true,
              supplierKey: true,
              supplierOrderNumber: true,
              status: true,
              trackingNumber: true,
              trackingUrl: true,
              etaMin: true,
              etaMax: true,
            },
          },
        },
      },
    },
  });

  if (!order || order.cancelledAt || order.archivedAt) {
    return {
      openUnits: [],
      unitSelection: decideFulfillUnitSelection([]),
    };
  }

  const [delrShipmentIds, existingItems] = await Promise.all([
    loadDelrShipmentIdsForOrders([order.id], [order.galaxusOrderId]),
    loadShipmentItemsForOrders([order.id]),
  ]);
  const coverage = computeShipmentCoverageForOrders(
    [
      {
        id: order.id,
        galaxusOrderId: order.galaxusOrderId,
        lines: order.lines.map((l) => ({
          id: l.id,
          quantity: l.quantity,
          buyerPid: l.buyerPid,
          supplierPid: l.supplierPid,
          gtin: l.gtin,
          warehouseMarkedShippedAt: l.warehouseMarkedShippedAt,
        })),
      },
    ],
    existingItems,
    delrShipmentIds
  );

  const openUnits: GalaxusDirectOpenUnit[] = [];
  for (const line of order.lines) {
    const rem = Math.max(0, Number(coverage[line.id]?.remaining ?? 0));
    if (rem <= 0) continue;
    const stockxProcurement: GalaxusDirectProcurementInfo[] = line.stockxMatches.map((match) => {
      const reference = text(match.stockxOrderNumber);
      const local = isLocalOrManualStockxRef(reference) || match.matchType === "LOCAL_STOCK";
      return {
        source: local ? "local" : "stockx",
        supplier: local ? "Stock local / manuel" : "StockX",
        unitIndex: match.unitIndex,
        reference,
        status: local
          ? text(match.stockxStatus) ?? "Réservée localement"
          : latestStockxStep(match.stockxStates, match.stockxStatus) ??
            (match.stockxAwb || match.stockxTrackingUrl
              ? "Expédiée — tracking disponible"
              : null),
        trackingNumber: text(match.stockxAwb),
        trackingUrl: text(match.stockxTrackingUrl),
        etaMin: match.stockxEstimatedDelivery?.toISOString() ?? null,
        etaMax: match.stockxLatestEstimatedDelivery?.toISOString() ?? null,
      };
    });
    const externalProcurement: GalaxusDirectProcurementInfo[] = line.externalBuys.map((buy) => ({
      source: "external",
      supplier: text(buy.supplierKey)?.toUpperCase() ?? "Autre fournisseur",
      unitIndex: buy.unitIndex,
      reference: text(buy.supplierOrderNumber),
      status:
        text(buy.status) ??
        (buy.trackingNumber || buy.trackingUrl ? "Expédiée — tracking disponible" : null),
      trackingNumber: text(buy.trackingNumber),
      trackingUrl: text(buy.trackingUrl),
      etaMin: buy.etaMin?.toISOString() ?? null,
      etaMax: buy.etaMax?.toISOString() ?? null,
    }));
    openUnits.push({
      lineItemId: line.id,
      lineId: line.id,
      title: String(line.productName ?? `Line ${line.lineNumber}`).trim() || `Line ${line.lineNumber}`,
      variantTitle: line.size ?? null,
      sku: line.gtin ?? null,
      remainingQuantity: rem,
      isScannedLine: scannedLineId ? line.id === scannedLineId : false,
      size: line.size ?? null,
      gtin: line.gtin ?? null,
      procurement: [...stockxProcurement, ...externalProcurement].sort(
        (a, b) => a.unitIndex - b.unitIndex
      ),
    });
  }

  return {
    openUnits,
    unitSelection: decideFulfillUnitSelection(openUnits),
  };
}
