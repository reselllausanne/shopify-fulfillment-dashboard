import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { isGalaxusShipmentDispatchConfirmed } from "@/galaxus/orders/shipmentDispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Number(searchParams.get("limit") ?? "20"), 100);
    const offset = Math.max(Number(searchParams.get("offset") ?? "0"), 0);
    const view = (searchParams.get("view") ?? "active").toLowerCase();
    if (!["active", "history"].includes(view)) {
      return NextResponse.json({ ok: false, error: "Invalid view filter" }, { status: 400 });
    }
    const where =
      view === "history"
        ? {
            OR: [{ archivedAt: { not: null } }, { cancelledAt: { not: null } }],
          }
        : {
            archivedAt: null,
            cancelledAt: null,
          };

    const orders = await prisma.galaxusOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      select: {
        id: true,
        galaxusOrderId: true,
        orderNumber: true,
        orderDate: true,
        deliveryType: true,
        customerName: true,
        recipientName: true,
        createdAt: true,
        ordrSentAt: true,
        ordrMode: true,
        archivedAt: true,
        cancelledAt: true,
        cancelReason: true,
        shipments: {
          select: { status: true, shippedAt: true, trackingNumber: true, galaxusShippedAt: true },
        },
        _count: {
          select: {
            lines: true,
            shipments: true,
          },
        },
      },
    });

    const items = orders.map((order) => {
      const shippedCount = order.shipments.filter(isGalaxusShipmentDispatchConfirmed).length;
      const { shipments, ...rest } = order;
      return { ...rest, shippedCount };
    });

    return NextResponse.json({
      ok: true,
      items,
      nextOffset: orders.length === limit ? offset + limit : null,
    });
  } catch (error: any) {
    console.error("[GALAXUS][ORDERS] List failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
