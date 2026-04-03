import type { PrismaClient } from "@prisma/client";

export type PurgeGalaxusOrderOptions = {
  /** If true, allow purge even when DELR was sent or order is not marked cancelled in DB. */
  force?: boolean;
};

/**
 * Permanently removes a Galaxus order and related rows (shipments, docs, STX units, partner orders, etc.).
 * Run inside or outside a transaction; uses its own transaction if `tx` is not provided.
 */
export async function purgeGalaxusOrderFromDb(
  prisma: PrismaClient,
  orderDbId: string,
  options: PurgeGalaxusOrderOptions = {}
): Promise<{ galaxusOrderId: string; deletedOrderId: string }> {
  const order = await prisma.galaxusOrder.findUnique({
    where: { id: orderDbId },
    include: {
      lines: { select: { id: true } },
      shipments: { select: { id: true, delrSentAt: true } },
    },
  });

  if (!order) {
    throw new Error("Order not found");
  }

  const { force = false } = options;

  if (!force) {
    if (!order.cancelledAt) {
      throw new Error(
        "Order is not marked cancelled in the database. Set cancelledAt (soft cancel) or pass force: true."
      );
    }
    const delrSent = order.shipments.some((s) => s.delrSentAt != null);
    if (delrSent) {
      throw new Error(
        "At least one shipment has DELR sent. Pass force: true if you still want to purge this order."
      );
    }
  }

  const lineIds = order.lines.map((l) => l.id);
  const shipmentIds = order.shipments.map((s) => s.id);
  const gxid = order.galaxusOrderId;

  await prisma.$transaction(async (tx) => {
    await tx.orderRoutingIssue.deleteMany({
      where: {
        OR: [{ orderId: order.id }, { orderLineId: { in: lineIds } }, { galaxusOrderId: gxid }],
      },
    });

    await tx.stxPurchaseUnit.deleteMany({ where: { galaxusOrderId: gxid } });

    if (shipmentIds.length > 0) {
      await tx.document.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await tx.galaxusEdiFile.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await tx.supplierOrder.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    }

    await tx.document.deleteMany({ where: { orderId: order.id } });
    await tx.galaxusEdiFile.deleteMany({ where: { orderId: order.id } });
    await tx.supplierOrder.deleteMany({ where: { orderId: order.id } });

    await tx.partnerOrder.deleteMany({ where: { galaxusOrderId: gxid } });

    await tx.shipment.deleteMany({ where: { orderId: order.id } });

    await tx.galaxusOrder.delete({ where: { id: order.id } });
  });

  return { galaxusOrderId: gxid, deletedOrderId: order.id };
}
