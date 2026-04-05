import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? "50"), 1), 200);
    const offset = Math.max(Number(searchParams.get("offset") ?? "0"), 0);
    const view = String(searchParams.get("view") ?? "active").trim();
    const where: Record<string, unknown> = {};
    if (view === "fulfilled") {
      where.orderState = "SHIPPED";
    } else if (view === "to_process") {
      where.OR = [
        { orderState: { not: "SHIPPED" } },
        { orderState: null },
      ];
    }
    const orders = await prisma.decathlonOrder.findMany({
      where,
      orderBy: { orderDate: "desc" },
      take: limit,
      skip: offset,
      include: {
        _count: { select: { lines: true, shipments: true } },
        shipments: { select: { shippedAt: true } },
      },
    });
    const matchRows = await prisma.decathlonStockxMatch.findMany({
      select: { decathlonOrderId: true, stockxOrderNumber: true, stockxOrderId: true },
    });
    const linkedByOrder = new Map<string, number>();
    for (const row of matchRows) {
      const onum = String(row.stockxOrderNumber ?? "").trim();
      const oid = String(row.stockxOrderId ?? "").trim();
      if (!onum && !oid) continue;
      linkedByOrder.set(row.decathlonOrderId, (linkedByOrder.get(row.decathlonOrderId) ?? 0) + 1);
    }
    const items = orders.map((order: any) => ({
      id: order.id,
      orderId: order.orderId,
      orderNumber: order.orderNumber ?? order.orderId,
      orderDate: order.orderDate,
      orderState: order.orderState ?? null,
      shippedCount: order.shipments?.filter((s: { shippedAt: unknown }) => Boolean(s.shippedAt)).length ?? 0,
      linkedCount: linkedByOrder.get(order.id) ?? 0,
      _count: order._count ?? { lines: 0, shipments: 0 },
    }));
    return NextResponse.json({ ok: true, items });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to load orders" },
      { status: 500 }
    );
  }
}
