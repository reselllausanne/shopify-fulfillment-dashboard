import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Search open order lines (warehouse delivery) to add to a composite shipment.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const orderQ = String(searchParams.get("order") ?? "").trim();
    const supplierOrder = String(searchParams.get("supplierOrder") ?? "").trim();
    const providerPid = String(searchParams.get("providerPid") ?? "").trim();
    const gtin = String(searchParams.get("gtin") ?? "").trim();
    const excludeOrderId = String(searchParams.get("excludeOrderId") ?? "").trim();
    const limit = Math.min(80, Math.max(1, Number(searchParams.get("limit") ?? 40)));

    const orderWhere: Record<string, unknown> = {
      deliveryType: "warehouse_delivery",
      cancelledAt: null,
    };
    if (excludeOrderId) {
      orderWhere.id = { not: excludeOrderId };
    }

    const orderMatch = orderQ || supplierOrder;
    if (orderMatch) {
      orderWhere.OR = [
        { galaxusOrderId: { contains: orderMatch } },
        { orderNumber: { contains: orderMatch } },
      ];
    }

    const lineWhere: Record<string, unknown> = { order: orderWhere };
    if (providerPid) {
      lineWhere.supplierPid = { contains: providerPid };
    }
    if (gtin) {
      lineWhere.gtin = { contains: gtin };
    }

    const lines = await prisma.galaxusOrderLine.findMany({
      where: lineWhere,
      include: {
        order: {
          select: {
            id: true,
            galaxusOrderId: true,
            orderNumber: true,
            orderDate: true,
            deliveryDate: true,
            recipientName: true,
          },
        },
      },
      orderBy: [{ order: { orderDate: "desc" } }, { lineNumber: "asc" }],
      take: limit,
    });

    const rows = lines.map((line) => ({
      lineId: line.id,
      sourceOrderId: line.orderId,
      galaxusOrderId: line.order.galaxusOrderId,
      orderNumber: line.order.orderNumber,
      supplierPid: line.supplierPid,
      buyerPid: line.buyerPid,
      gtin: line.gtin,
      productName: line.productName,
      lineNumber: line.lineNumber,
      quantity: line.quantity,
      orderDate: line.order.orderDate,
      expectedDelivery: line.order.deliveryDate,
    }));

    return NextResponse.json({ ok: true, rows });
  } catch (error: any) {
    console.error("[GALAXUS][LINE_SEARCH]", error);
    return NextResponse.json({ ok: false, error: error?.message ?? "Search failed" }, { status: 500 });
  }
}
