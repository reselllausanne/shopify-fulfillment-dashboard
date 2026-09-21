import "server-only";

import { prisma } from "@/app/lib/prisma";
import { resetDelrForShipment } from "@/galaxus/warehouse/resetDelr";
import { removeGalaxusDelrFulfillmentExpenses } from "@/galaxus/warehouse/delrFulfillmentExpenses";

export type UnshipDirectOrderResult = {
  ok: boolean;
  orderId: string;
  galaxusOrderId?: string;
  shipmentsReset: number;
  shipmentsDeleted: number;
  linesUnmarked: number;
  message: string;
  error?: string;
};

async function deleteShipmentCascade(shipmentId: string): Promise<void> {
  const prismaAny = prisma as any;
  await prismaAny.supplierOrder?.deleteMany?.({ where: { shipmentId } }).catch(() => undefined);
  await prisma.document.deleteMany({ where: { shipmentId } }).catch(() => undefined);
  await prisma.shipmentItem.deleteMany({ where: { shipmentId } }).catch(() => undefined);
  await prisma.shipment.deleteMany({ where: { id: shipmentId } }).catch(() => undefined);
}

/**
 * Put a mistaken direct-delivery ship back to open / unfulfilled:
 * reset DELR if needed, delete shipments, clear warehouseMarkedShippedAt.
 * Does not call Galaxus to cancel an already-ingested DELR — operator must
 * confirm the file was not processed / is safe to redo locally.
 */
export async function unshipGalaxusDirectOrder(
  orderIdOrRef: string
): Promise<UnshipDirectOrderResult> {
  const order = await prisma.galaxusOrder.findFirst({
    where: {
      OR: [{ id: orderIdOrRef }, { galaxusOrderId: orderIdOrRef }],
    },
    select: {
      id: true,
      galaxusOrderId: true,
      deliveryType: true,
      shipments: {
        select: {
          id: true,
          status: true,
          delrSentAt: true,
          delrStatus: true,
          trackingNumber: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!order) {
    return {
      ok: false,
      orderId: orderIdOrRef,
      shipmentsReset: 0,
      shipmentsDeleted: 0,
      linesUnmarked: 0,
      message: "Order not found",
      error: "Order not found",
    };
  }

  if (String(order.deliveryType ?? "").toLowerCase() !== "direct_delivery") {
    return {
      ok: false,
      orderId: order.id,
      galaxusOrderId: order.galaxusOrderId,
      shipmentsReset: 0,
      shipmentsDeleted: 0,
      linesUnmarked: 0,
      message: "Order is not direct_delivery",
      error: "Order is not direct_delivery",
    };
  }

  let shipmentsReset = 0;
  let shipmentsDeleted = 0;

  for (const shipment of order.shipments) {
    const delrStatus = String(shipment.delrStatus ?? "").toUpperCase();
    const status = String(shipment.status ?? "").toUpperCase();
    const needsReset =
      Boolean(shipment.delrSentAt) ||
      delrStatus === "UPLOADED" ||
      delrStatus === "SENT" ||
      status === "FULFILLED";

    if (needsReset) {
      const reset = await resetDelrForShipment(shipment.id);
      if (reset.ok) shipmentsReset += 1;
      // Even if reset returns 409, force MANUAL so delete can proceed.
      if (!reset.ok) {
        await prisma.shipment
          .update({
            where: { id: shipment.id },
            data: {
              status: "MANUAL",
              delrSentAt: null,
              delrFileName: null,
              delrStatus: "PENDING",
              delrError: null,
              galaxusShippedAt: null,
              trackingNumber: null,
              shippingLabelPdfUrl: null,
              deliveryNotePdfUrl: null,
            } as any,
          })
          .catch(() => undefined);
        shipmentsReset += 1;
      }
    } else {
      // Clear label/tracking on open drafts before delete.
      await prisma.shipment
        .update({
          where: { id: shipment.id },
          data: {
            trackingNumber: null,
            shippingLabelPdfUrl: null,
            deliveryNotePdfUrl: null,
          } as any,
        })
        .catch(() => undefined);
    }

    await removeGalaxusDelrFulfillmentExpenses(shipment.id).catch(() => undefined);
    await deleteShipmentCascade(shipment.id);
    shipmentsDeleted += 1;
  }

  const unmarked = await prisma.galaxusOrderLine.updateMany({
    where: { orderId: order.id, warehouseMarkedShippedAt: { not: null } },
    data: { warehouseMarkedShippedAt: null },
  });

  const linesUnmarked = unmarked.count ?? 0;

  return {
    ok: true,
    orderId: order.id,
    galaxusOrderId: order.galaxusOrderId,
    shipmentsReset,
    shipmentsDeleted,
    linesUnmarked,
    message: `Unshipped: ${shipmentsDeleted} shipment(s) removed, ${linesUnmarked} line(s) reopened. Order is back to À traiter.`,
  };
}
