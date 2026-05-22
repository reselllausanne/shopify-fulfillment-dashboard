import "server-only";

import { prisma } from "@/app/lib/prisma";

export type WarehouseLineShipmentCoverage = {
  ordered: number;
  shipped: number;
  reserved: number;
  remaining: number;
};

export type WarehouseOrderForCoverage = {
  id: string;
  galaxusOrderId: string;
  lines: Array<{
    id: string;
    quantity: number | null;
    buyerPid?: string | null;
    supplierPid?: string | null;
    gtin?: string | null;
    warehouseMarkedShippedAt?: Date | null;
  }>;
};

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function shipmentIsReserved(item: {
  shipment?: { delrSentAt?: Date | null; delrStatus?: string | null; status?: string | null } | null;
}): boolean {
  const status = normalizeText(item.shipment?.status).toUpperCase();
  const delrStatus = normalizeText(item.shipment?.delrStatus).toUpperCase();
  if (status !== "MANUAL") return false;
  if (item.shipment?.delrSentAt) return false;
  if (delrStatus === "UPLOADED" || delrStatus === "SENT") return false;
  return true;
}

function shipmentIsFinalized(item: {
  shipment?: { delrSentAt?: Date | null; delrStatus?: string | null } | null;
}): boolean {
  const delrStatus = normalizeText(item.shipment?.delrStatus).toUpperCase();
  return Boolean(item.shipment?.delrSentAt) || delrStatus === "UPLOADED" || delrStatus === "SENT";
}

function getPayloadShipmentId(payloadJson: unknown): string | null {
  if (!payloadJson || typeof payloadJson !== "object") return null;
  const id = String((payloadJson as { shipmentId?: unknown }).shipmentId ?? "").trim();
  return id || null;
}

function digitsOnlyGtin(s: string): string {
  return String(s ?? "").replace(/\D/g, "");
}

function sameGtinKey(a: string, b: string): boolean {
  const da = digitsOnlyGtin(a);
  const db = digitsOnlyGtin(b);
  if (!da || !db) return false;
  if (da === db) return true;
  const na = da.padStart(14, "0").slice(-14);
  const nb = db.padStart(14, "0").slice(-14);
  return na === nb;
}

export async function loadDelrShipmentIdsForOrders(orderIds: string[], orderRefs: string[]): Promise<Set<string>> {
  const delrShipmentIds = new Set<string>();
  if (orderIds.length === 0 && orderRefs.length === 0) return delrShipmentIds;

  const delrFiles = await (prisma as any).galaxusEdiFile.findMany({
    where: {
      direction: "OUT",
      docType: "DELR",
      status: { in: ["uploaded", "processed", "UPLOADED", "PROCESSED", "sent", "SENT"] },
      OR: [
        ...(orderIds.length > 0 ? [{ orderId: { in: orderIds } }] : []),
        ...(orderRefs.length > 0 ? [{ orderRef: { in: orderRefs } }] : []),
      ],
    },
    select: {
      shipmentId: true,
      payloadJson: true,
    },
  });

  for (const file of delrFiles as Array<{ shipmentId?: string | null; payloadJson?: unknown }>) {
    const shipmentId = normalizeText(file?.shipmentId) || getPayloadShipmentId(file?.payloadJson);
    if (shipmentId) delrShipmentIds.add(shipmentId);
  }
  return delrShipmentIds;
}

export async function loadShipmentItemsForOrders(orderIds: string[]) {
  if (orderIds.length === 0) return [];
  return (prisma as any).shipmentItem.findMany({
    where: { orderId: { in: orderIds } },
    select: {
      shipmentId: true,
      orderId: true,
      buyerPid: true,
      supplierPid: true,
      gtin14: true,
      quantity: true,
      shipment: {
        select: { delrSentAt: true, delrStatus: true, status: true },
      },
    },
  });
}

export function computeShipmentCoverageForOrders(
  orders: WarehouseOrderForCoverage[],
  existingItems: any[],
  delrShipmentIds: Set<string>
): Record<string, WarehouseLineShipmentCoverage> {
  const shipmentCoverage: Record<string, WarehouseLineShipmentCoverage> = {};

  for (const order of orders) {
    for (const line of order.lines ?? []) {
      const lineId = String(line.id);
      const buyerPid = normalizeText(line.buyerPid);
      const supplierPid = normalizeText(line.supplierPid);
      const supplierPidKey = supplierPid.toLowerCase();
      const gtin = normalizeText(line.gtin);
      const orderedQty = Number(line.quantity ?? 0);
      const markedShipped = Boolean(line?.warehouseMarkedShippedAt);

      const lineMatchesShipmentItem = (item: any) => {
        if (String(item?.orderId ?? "") !== String(order.id)) return false;
        const itemBuyerPid = normalizeText(item?.buyerPid);
        if (buyerPid && itemBuyerPid) {
          return itemBuyerPid === buyerPid;
        }
        const itemSupplierPid = normalizeText(item?.supplierPid);
        const itemSupplierPidKey = itemSupplierPid.toLowerCase();
        const itemGtin = normalizeText(item?.gtin14);
        const canComparePid = Boolean(supplierPid && itemSupplierPid);
        const canCompareGtin = Boolean(gtin && itemGtin);

        if (canComparePid && canCompareGtin) {
          return supplierPidKey === itemSupplierPidKey && sameGtinKey(itemGtin, gtin);
        }
        if (canComparePid) return supplierPidKey === itemSupplierPidKey;
        if (canCompareGtin) return sameGtinKey(itemGtin, gtin);
        return false;
      };

      const shipped = existingItems
        .filter((item: any) => {
          if (!lineMatchesShipmentItem(item)) return false;
          const shipmentId = normalizeText(item?.shipmentId);
          const fromDelrHistory = shipmentId ? delrShipmentIds.has(shipmentId) : false;
          return shipmentIsFinalized(item) || fromDelrHistory;
        })
        .reduce((acc: number, item: any) => acc + Math.max(0, Number(item?.quantity ?? 0)), 0);

      const reserved = existingItems
        .filter((item: any) => {
          if (!lineMatchesShipmentItem(item)) return false;
          const shipmentId = normalizeText(item?.shipmentId);
          if (shipmentId && delrShipmentIds.has(shipmentId)) return false;
          return shipmentIsReserved(item);
        })
        .reduce((acc: number, item: any) => acc + Math.max(0, Number(item?.quantity ?? 0)), 0);

      const ordered = Number.isFinite(orderedQty) ? orderedQty : 0;
      const shippedFinal =
        markedShipped && shipped + reserved >= ordered ? Math.max(shipped, ordered) : shipped;

      shipmentCoverage[lineId] = {
        ordered,
        shipped: shippedFinal,
        reserved,
        remaining: Math.max(0, ordered - shippedFinal - reserved),
      };
    }
  }

  return shipmentCoverage;
}

export function countOpenWarehouseLinesByOrderId(
  orders: WarehouseOrderForCoverage[],
  shipmentCoverage: Record<string, WarehouseLineShipmentCoverage>
): Map<string, number> {
  const openByOrderId = new Map<string, number>();
  for (const order of orders) {
    let open = 0;
    for (const line of order.lines ?? []) {
      const remaining = shipmentCoverage[String(line.id)]?.remaining ?? 0;
      if (remaining > 0) open += 1;
    }
    openByOrderId.set(order.id, open);
  }
  return openByOrderId;
}

export async function getOpenWarehouseLineCountByOrderId(
  orderIds: string[]
): Promise<Map<string, number>> {
  if (orderIds.length === 0) return new Map();

  const orders = await prisma.galaxusOrder.findMany({
    where: { id: { in: orderIds } },
    select: {
      id: true,
      galaxusOrderId: true,
      lines: {
        select: {
          id: true,
          quantity: true,
          buyerPid: true,
          supplierPid: true,
          gtin: true,
          warehouseMarkedShippedAt: true,
        },
      },
    },
  });

  const orderRefs = Array.from(
    new Set(orders.map((o) => String(o.galaxusOrderId ?? "").trim()).filter(Boolean))
  );
  const [delrShipmentIds, existingItems] = await Promise.all([
    loadDelrShipmentIdsForOrders(orderIds, orderRefs),
    loadShipmentItemsForOrders(orderIds),
  ]);

  const coverage = computeShipmentCoverageForOrders(orders, existingItems, delrShipmentIds);
  return countOpenWarehouseLinesByOrderId(orders, coverage);
}
