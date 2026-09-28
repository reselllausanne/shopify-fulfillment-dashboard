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

export type GalaxusDirectOpenUnit = FulfillOpenUnit & {
  lineId: string;
  size: string | null;
  gtin: string | null;
};

export type GalaxusDirectOpenUnitsResult = {
  openUnits: GalaxusDirectOpenUnit[];
  unitSelection: UnitSelectionDecision;
};

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
    });
  }

  return {
    openUnits,
    unitSelection: decideFulfillUnitSelection(openUnits),
  };
}
