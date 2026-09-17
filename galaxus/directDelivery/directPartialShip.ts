import "server-only";

import { prisma } from "@/app/lib/prisma";

export {
  orderRequiresPartialDirectShip,
  PARTIAL_DIRECT_SHIP_MESSAGE,
} from "@/galaxus/directDelivery/directPartialShipRules";

export type ReopenPhantomDirectShipmentResult =
  | {
      ok: true;
      galaxusOrderId: string;
      removedShipmentIds: string[];
      voidedDelrFiles: number;
      note: string;
    }
  | { ok: false; error: string };

/**
 * Remove local shipment + DELR rows that never reached Galaxus (portal still shows unshipped).
 * Restores line remaining for partial fulfill.
 */
export async function reopenPhantomDirectShipment(
  orderIdOrRef: string,
  options?: { shipmentBusinessId?: string; confirm?: boolean }
): Promise<ReopenPhantomDirectShipmentResult> {
  if (!options?.confirm) {
    return { ok: false, error: "confirm: true required" };
  }

  const order = await prisma.galaxusOrder.findFirst({
    where: { OR: [{ id: orderIdOrRef }, { galaxusOrderId: orderIdOrRef }] },
    select: { id: true, galaxusOrderId: true, deliveryType: true },
  });
  if (!order) return { ok: false, error: "Order not found" };
  if (String(order.deliveryType ?? "").toLowerCase() !== "direct_delivery") {
    return { ok: false, error: "Order is not direct_delivery" };
  }

  const shipmentWhere = options?.shipmentBusinessId
    ? { orderId: order.id, shipmentId: options.shipmentBusinessId }
    : { orderId: order.id };

  const shipments = await prisma.shipment.findMany({
    where: shipmentWhere,
    select: { id: true, shipmentId: true },
  });
  if (shipments.length === 0) {
    return { ok: false, error: "No shipment rows to void on this order" };
  }

  const shipmentDbIds = shipments.map((s) => s.id);
  const prismaAny = prisma as any;

  let voidedDelrFiles = 0;
  await prismaAny.$transaction(async (tx: any) => {
    const delrUpdate = await tx.galaxusEdiFile.updateMany({
      where: {
        shipmentId: { in: shipmentDbIds },
        direction: "OUT",
        docType: "DELR",
      },
      data: {
        status: "voided_local",
        errorMessage: "Voided locally — Galaxus portal did not receive this dispatch",
        updatedAt: new Date(),
      },
    });
    voidedDelrFiles = delrUpdate.count ?? 0;

    await tx.document.deleteMany({ where: { shipmentId: { in: shipmentDbIds } } });
    await tx.shipmentItem.deleteMany({ where: { shipmentId: { in: shipmentDbIds } } });
    await tx.shipment.deleteMany({ where: { id: { in: shipmentDbIds } } });
  });

  return {
    ok: true,
    galaxusOrderId: order.galaxusOrderId,
    removedShipmentIds: shipments.map((s) => s.shipmentId),
    voidedDelrFiles,
    note:
      "Local shipment cleared. Galaxus vendor portal was already unshipped — ship partial qty with Ship qty.",
  };
}
