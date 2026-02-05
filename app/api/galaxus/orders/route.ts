import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Number(searchParams.get("limit") ?? "20"), 100);
    const offset = Math.max(Number(searchParams.get("offset") ?? "0"), 0);

    const orders = await prisma.galaxusOrder.findMany({
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
        _count: {
          select: {
            lines: true,
            shipments: true,
          },
        },
      },
    });

    return NextResponse.json({
      ok: true,
      items: orders,
      nextOffset: orders.length === limit ? offset + limit : null,
    });
  } catch (error: any) {
    console.error("[GALAXUS][ORDERS] List failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
