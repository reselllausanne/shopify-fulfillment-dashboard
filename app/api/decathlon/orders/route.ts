import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? "50"), 1), 200);
    const offset = Math.max(Number(searchParams.get("offset") ?? "0"), 0);
    const view = String(searchParams.get("view") ?? "active").trim();
    const scope = String(searchParams.get("scope") ?? "").trim().toLowerCase();
    const where: Record<string, unknown> = {};
    if (scope === "partner") {
      const partnerSession = await getPartnerSession(request);
      if (!partnerSession) {
        return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
      }
      const sessionPartnerKey = normalizeProviderKey(partnerSession?.partnerKey ?? null);
      if (!sessionPartnerKey) {
        return NextResponse.json({ ok: false, error: "Partner key missing" }, { status: 400 });
      }
      where.partnerKey = sessionPartnerKey;
    }
    const canceledStates = ["CANCELED", "CANCELLED", "ORDER_CANCELLED", "CLOSED"];
    const nonProcessStates = ["SHIPPED", ...canceledStates];
    if (view === "fulfilled") {
      where.shipments = { some: { shippedAt: { not: null } } };
    } else if (view === "to_process") {
      where.AND = [
        { shipments: { none: {} } },
        {
          OR: [
            { orderState: { notIn: nonProcessStates, mode: "insensitive" } },
            { orderState: null },
          ],
        },
      ];
    } else if (view === "canceled") {
      where.orderState = { in: canceledStates, mode: "insensitive" };
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
      select: {
        decathlonOrderId: true,
        stockxOrderNumber: true,
        stockxOrderId: true,
        stockxChainId: true,
      },
    });
    const linkedByOrder = new Map<string, number>();
    for (const row of matchRows) {
      const onum = String(row.stockxOrderNumber ?? "").trim();
      const oid = String(row.stockxOrderId ?? "").trim();
      const chain = String(row.stockxChainId ?? "").trim();
      if (!onum && !oid && !chain) continue;
      linkedByOrder.set(row.decathlonOrderId, (linkedByOrder.get(row.decathlonOrderId) ?? 0) + 1);
    }
    const items = orders.map((order: any) => ({
      id: order.id,
      orderId: order.orderId,
      orderNumber: order.orderNumber ?? order.orderId,
      orderDate: order.orderDate,
      orderState: order.orderState ?? null,
      partnerKey: order.partnerKey ?? null,
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
