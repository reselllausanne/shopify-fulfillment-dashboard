import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
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
    const productSearch = String(searchParams.get("product") ?? "").trim();
    let where: Prisma.DecathlonOrderWhereInput = {};
    let sessionPartnerKey: string | null = null;
    if (scope === "partner") {
      const partnerSession = await getPartnerSession(request);
      if (!partnerSession) {
        return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
      }
      sessionPartnerKey = normalizeProviderKey(partnerSession?.partnerKey ?? null);
      if (!sessionPartnerKey) {
        return NextResponse.json({ ok: false, error: "Partner key missing" }, { status: 400 });
      }
      const keyPrefix = `${sessionPartnerKey}_`;
      where.OR = [
        { partnerKey: sessionPartnerKey },
        { lines: { some: { offerSku: { startsWith: keyPrefix } } } },
      ];
    }
    const canceledStates = ["CANCELED", "CANCELLED", "ORDER_CANCELLED", "CLOSED"];
    if (view === "canceled") {
      where.orderState = { in: canceledStates, mode: "insensitive" };
    }

    if (productSearch.length > 0) {
      const byLineName: Prisma.DecathlonOrderWhereInput = {
        lines: {
          some: {
            OR: [
              { productTitle: { contains: productSearch, mode: "insensitive" } },
              { description: { contains: productSearch, mode: "insensitive" } },
            ],
          },
        },
      };
      if (Array.isArray(where.AND)) {
        where = { ...where, AND: [...where.AND, byLineName] };
      } else {
        const keys = Object.keys(where);
        if (keys.length === 0) {
          where = byLineName;
        } else {
          const prior = { ...where };
          where = { AND: [prior, byLineName] };
        }
      }
    }

    const orders = await prisma.decathlonOrder.findMany({
      where,
      orderBy: { orderDate: "desc" },
      take: limit,
      skip: offset,
      include: {
        _count: { select: { lines: true, shipments: true } },
        lines: { select: { id: true, quantity: true } },
        shipments: { select: { shippedAt: true, lines: { select: { orderLineId: true, quantity: true } } } },
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
    const items = orders.map((order: any) => {
      const lines = Array.isArray(order.lines) ? order.lines : [];
      const totalUnits = lines.reduce((sum: number, line: any) => sum + Number(line.quantity ?? 0), 0);
      const shipmentLines = (order.shipments ?? []).flatMap((shipment: any) => shipment.lines ?? []);
      const hasLegacyShipment = shipmentLines.length === 0 && (order.shipments ?? []).some((s: any) => s.shippedAt);
      const shippedUnits = hasLegacyShipment
        ? totalUnits
        : shipmentLines.reduce((sum: number, line: any) => sum + Number(line.quantity ?? 0), 0);
      const remainingUnits = Math.max(totalUnits - shippedUnits, 0);
      return {
        id: order.id,
        orderId: order.orderId,
        orderNumber: order.orderNumber ?? order.orderId,
        orderDate: order.orderDate,
        orderState: order.orderState ?? null,
        partnerKey: order.partnerKey ?? null,
        shippedCount: order.shipments?.filter((s: { shippedAt: unknown }) => Boolean(s.shippedAt)).length ?? 0,
        shippedUnits,
        totalUnits,
        remainingUnits,
        linkedCount: linkedByOrder.get(order.id) ?? 0,
        _count: order._count ?? { lines: 0, shipments: 0 },
      };
    });
    return NextResponse.json({ ok: true, items });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to load orders" },
      { status: 500 }
    );
  }
}
