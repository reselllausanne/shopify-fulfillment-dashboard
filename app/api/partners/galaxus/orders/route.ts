import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession, isPartnerRoleAllowed } from "@/app/lib/partnerAuth";
import { isPartnerSelfFulfillEnabled } from "@/app/lib/partnerSelfFulfill";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";
import { isGalaxusShipmentDispatchConfirmed } from "@/galaxus/orders/shipmentDispatch";
import {
  buildPartnerGalaxusOrderWhere,
  lineMatchesPartnerScope,
  loadPartnerMappedGtins,
} from "./partnerLineScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await getPartnerSession(req);
    if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    if (!isPartnerRoleAllowed(session.role)) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    if (!isPartnerSelfFulfillEnabled(session.partnerKey)) {
      return NextResponse.json({ ok: false, error: "Partner self-fulfill disabled" }, { status: 403 });
    }
    const pk = normalizeProviderKey(session.partnerKey);
    if (!pk) return NextResponse.json({ ok: false, error: "Partner key missing" }, { status: 400 });

    const { searchParams } = new URL(req.url);
    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? "50"), 1), 200);
    const offset = Math.max(Number(searchParams.get("offset") ?? "0"), 0);
    const deliveryTypeFilter = String(searchParams.get("deliveryType") ?? "").trim().toLowerCase();

    const partnerGtins = await loadPartnerMappedGtins(pk);
    const partnerGtinSet = new Set(partnerGtins);
    const where = buildPartnerGalaxusOrderWhere(pk, partnerGtins);
    if (deliveryTypeFilter === "direct_delivery" || deliveryTypeFilter === "warehouse_delivery") {
      where.deliveryType = deliveryTypeFilter;
    }

    const orders = await prisma.galaxusOrder.findMany({
      where,
      orderBy: [{ orderDate: "desc" }, { createdAt: "desc" }],
      take: limit + 1,
      skip: offset,
      select: {
        id: true,
        galaxusOrderId: true,
        orderNumber: true,
        orderDate: true,
        deliveryType: true,
        cancelledAt: true,
        archivedAt: true,
        ordrStatus: true,
        lines: {
          select: {
            id: true,
            gtin: true,
            quantity: true,
            providerKey: true,
            supplierVariantId: true,
            supplierPid: true,
            supplierSku: true,
            warehouseMarkedShippedAt: true,
          },
        },
        shipments: {
          select: {
            shippedAt: true,
            trackingNumber: true,
            galaxusShippedAt: true,
            delrSentAt: true,
            delrStatus: true,
          },
        },
        _count: { select: { lines: true, shipments: true } },
      },
    });

    const hasMore = orders.length > limit;
    const page = hasMore ? orders.slice(0, limit) : orders;

    const items = page.map((order) => {
      const partnerLines = order.lines.filter((line) => lineMatchesPartnerScope(line, pk, partnerGtinSet));
      const totalUnits = partnerLines.reduce((sum, line) => sum + Number(line.quantity ?? 0), 0);
      const warehouseLinesShipped = partnerLines.filter((line) => line.warehouseMarkedShippedAt).length;
      const isDirect = String(order.deliveryType ?? "").toLowerCase() === "direct_delivery";
      const shippedCount = isDirect
        ? order.shipments.filter((shipment) => Boolean(shipment.trackingNumber)).length
        : order.shipments.filter(isGalaxusShipmentDispatchConfirmed).length;
      const fulfilledCount = isDirect
        ? order.shipments.filter((shipment) => Boolean(shipment.delrSentAt)).length
        : order.shipments.filter((shipment) => {
            const delrStatus = String(shipment.delrStatus ?? "").toUpperCase();
            return Boolean(shipment.delrSentAt) || delrStatus === "UPLOADED" || delrStatus === "SENT";
          }).length;
      const fulfillmentState =
        fulfilledCount > 0 || (partnerLines.length > 0 && warehouseLinesShipped >= partnerLines.length)
          ? "fulfilled"
          : shippedCount > 0
            ? "shipped"
            : "to_process";

      return {
        id: order.id,
        galaxusOrderId: order.galaxusOrderId,
        orderNumber: order.orderNumber ?? order.galaxusOrderId,
        orderDate: order.orderDate,
        deliveryType: order.deliveryType ?? null,
        cancelledAt: order.cancelledAt ?? null,
        archivedAt: order.archivedAt ?? null,
        ordrStatus: order.ordrStatus ?? null,
        shippedCount,
        fulfilledCount,
        warehouseLinesShipped,
        totalUnits,
        lineCount: partnerLines.length,
        fulfillmentState,
        _count: order._count,
      };
    });

    return NextResponse.json({
      ok: true,
      items,
      nextOffset: hasMore && items.length > 0 ? offset + items.length : null,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to load Galaxus orders" },
      { status: 500 }
    );
  }
}
