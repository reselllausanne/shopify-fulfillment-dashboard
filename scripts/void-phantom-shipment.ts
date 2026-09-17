import { prisma } from "@/app/lib/prisma";

async function main() {
  const orderRef = process.argv[2];
  if (!orderRef) {
    console.error("Usage: npx tsx scripts/void-phantom-shipment.ts <galaxusOrderId>");
    process.exit(1);
  }

  const order = await prisma.galaxusOrder.findFirst({
    where: { OR: [{ id: orderRef }, { galaxusOrderId: orderRef }] },
    select: { id: true, galaxusOrderId: true, deliveryType: true },
  });
  if (!order) throw new Error("Order not found");
  if (String(order.deliveryType ?? "").toLowerCase() !== "direct_delivery") {
    throw new Error("Order is not direct_delivery");
  }

  const shipments = await prisma.shipment.findMany({
    where: { orderId: order.id },
    select: { id: true, shipmentId: true, delrStatus: true, delrSentAt: true },
  });
  if (shipments.length === 0) {
    console.log(JSON.stringify({ ok: true, note: "No shipments to void", galaxusOrderId: order.galaxusOrderId }));
    return;
  }

  const shipmentDbIds = shipments.map((s) => s.id);
  const prismaAny = prisma as any;

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
    await tx.document.deleteMany({ where: { shipmentId: { in: shipmentDbIds } } });
    await tx.shipmentItem.deleteMany({ where: { shipmentId: { in: shipmentDbIds } } });
    await tx.shipment.deleteMany({ where: { id: { in: shipmentDbIds } } });
    console.log(
      JSON.stringify(
        {
          ok: true,
          galaxusOrderId: order.galaxusOrderId,
          removedShipmentIds: shipments.map((s) => s.shipmentId),
          voidedDelrFiles: delrUpdate.count ?? 0,
        },
        null,
        2
      )
    );
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
