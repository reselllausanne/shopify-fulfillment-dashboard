import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const drafts = await prisma.shipment.findMany({
      where: {
        status: "MANUAL",
        delrSentAt: null,
        OR: [{ delrStatus: null }, { delrStatus: "PENDING" }, { delrStatus: "ERROR" }],
        order: {
          archivedAt: null,
          cancelledAt: null,
          deliveryType: { not: "direct_delivery" },
        },
      },
      include: {
        order: true,
        items: { include: { order: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    const payload = drafts.map((shipment) => {
      const orderNumbers = Array.from(
        new Set(
          (shipment.items ?? [])
            .map((item: any) => item.order?.orderNumber ?? item.order?.galaxusOrderId)
            .filter(Boolean)
        )
      );
      return {
        id: shipment.id,
        shipmentId: shipment.shipmentId,
        dispatchNotificationId: shipment.dispatchNotificationId ?? null,
        packageId: shipment.packageId ?? null,
        trackingNumber: shipment.trackingNumber ?? null,
        delrStatus: shipment.delrStatus ?? null,
        createdAt: shipment.createdAt,
        orderNumbers,
        itemCount: (shipment.items ?? []).length,
        anchorOrderId: shipment.orderId ?? null,
        anchorOrderNumber: shipment.order?.orderNumber ?? shipment.order?.galaxusOrderId ?? null,
      };
    });

    return NextResponse.json({ ok: true, drafts: payload });
  } catch (error: any) {
    console.error("[GALAXUS][WAREHOUSE][DRAFTS] Failed:", error);
    return NextResponse.json({ ok: false, error: error?.message ?? "Failed" }, { status: 500 });
  }
}
