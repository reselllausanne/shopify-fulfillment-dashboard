import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const { orderId } = await params;
    const order =
      (await prisma.galaxusOrder.findUnique({
        where: { id: orderId },
        include: {
          lines: true,
          shipments: {
            include: {
              items: true,
              documents: true,
            },
          },
          statusEvents: true,
          ediFiles: true,
        },
      })) ??
      (await prisma.galaxusOrder.findUnique({
        where: { galaxusOrderId: orderId },
        include: {
          lines: true,
          shipments: {
            include: {
              items: true,
              documents: true,
            },
          },
          statusEvents: true,
          ediFiles: true,
        },
      }));

    if (!order) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }

    const normalized = {
      ...order,
      shipments: order.shipments.map((shipment: any) => {
        const deliveryNote = shipment.documents?.find((doc: any) => doc.type === "DELIVERY_NOTE");
        return {
          ...shipment,
          deliveryNotePdfUrl: deliveryNote?.storageUrl ?? null,
        };
      }),
    };

    return NextResponse.json({ ok: true, order: normalized });
  } catch (error: any) {
    console.error("[GALAXUS][ORDERS] Detail failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
