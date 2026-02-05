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
            },
          },
          statusEvents: true,
        },
      })) ??
      (await prisma.galaxusOrder.findUnique({
        where: { galaxusOrderId: orderId },
        include: {
          lines: true,
          shipments: {
            include: {
              items: true,
            },
          },
          statusEvents: true,
        },
      }));

    if (!order) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, order });
  } catch (error: any) {
    console.error("[GALAXUS][ORDERS] Detail failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
