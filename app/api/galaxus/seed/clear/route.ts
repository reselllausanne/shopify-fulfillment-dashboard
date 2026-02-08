import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const prismaAny = prisma as any;
    const orders = await prismaAny.galaxusOrder.findMany({
      where: { galaxusOrderId: { startsWith: "GX-" } },
      select: { id: true },
    });
    const orderIds = orders.map((order: { id: string }) => order.id);
    if (orderIds.length === 0) {
      return NextResponse.json({ ok: true, deletedOrders: 0 });
    }

    await prismaAny.$transaction(async (tx: any) => {
      await tx.shipmentItem.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.shipment.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.orderStatusEvent.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.supplierOrder.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.galaxusEdiFile.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.galaxusOrderLine.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.galaxusOrder.deleteMany({ where: { id: { in: orderIds } } });
    });

    return NextResponse.json({ ok: true, deletedOrders: orderIds.length });
  } catch (error: any) {
    console.error("[GALAXUS][SEED][CLEAR] Failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
