import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { isGalaxusShipmentDispatchConfirmed } from "@/galaxus/orders/shipmentDispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function findOrder(orderId: string) {
  const byId = await prisma.galaxusOrder.findUnique({ where: { id: orderId } });
  if (byId) return byId;
  return prisma.galaxusOrder.findUnique({ where: { galaxusOrderId: orderId } });
}

export async function POST(_request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const { orderId } = await params;
    const order = await findOrder(orderId);
    if (!order) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }
    if (order.cancelledAt) {
      return NextResponse.json({ ok: false, error: "Cancelled orders cannot be archived" }, { status: 409 });
    }
    if (order.archivedAt) {
      return NextResponse.json({ ok: true, archivedAt: order.archivedAt.toISOString(), alreadyArchived: true });
    }

    const shipments = await prisma.shipment.findMany({
      where: { orderId: order.id },
      select: { id: true, status: true, shippedAt: true, trackingNumber: true, galaxusShippedAt: true },
    });
    const totalShipments = shipments.length;
    const shippedCount = shipments.filter(isGalaxusShipmentDispatchConfirmed).length;
    if (totalShipments === 0 || shippedCount < totalShipments) {
      return NextResponse.json(
        {
          ok: false,
          error: "Order is not fully shipped",
          shippedCount,
          totalShipments,
        },
        { status: 409 }
      );
    }

    const updated = await prisma.galaxusOrder.update({
      where: { id: order.id },
      data: { archivedAt: new Date() },
      select: { archivedAt: true },
    });
    return NextResponse.json({
      ok: true,
      archivedAt: updated.archivedAt?.toISOString() ?? null,
      shippedCount,
      totalShipments,
    });
  } catch (error: any) {
    console.error("[GALAXUS][ORDERS][ARCHIVE] Failed:", error);
    return NextResponse.json({ ok: false, error: error?.message ?? "Archive failed" }, { status: 500 });
  }
}
