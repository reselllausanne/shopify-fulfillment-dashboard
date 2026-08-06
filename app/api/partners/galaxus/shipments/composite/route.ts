import { NextRequest, NextResponse } from "next/server";
import { createCompositeWarehouseShipment } from "@/galaxus/warehouse/shipments";
import { prisma } from "@/app/lib/prisma";
import { requirePartnerSelfFulfillAccess } from "@/app/api/partners/galaxus/_auth";
import {
  collectGtinsFromLines,
  lineMatchesPartnerScope,
  resolvePartnerGtins,
} from "@/app/api/partners/galaxus/orders/partnerLineScope";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  anchorOrderId?: string;
  items?: Array<{ lineId?: string; sourceOrderId?: string; quantity?: number }>;
  confirmReplace?: boolean;
  trackingNumber?: string | null;
  carrierFinal?: string | null;
};

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requirePartnerSelfFulfillAccess(request);
    if (!auth.access) return auth.response!;
    const access = auth.access;

    const body = (await request.json().catch(() => ({}))) as Body;
    const anchorOrderId = normalize(body.anchorOrderId);
    if (!anchorOrderId) {
      return NextResponse.json({ ok: false, error: "anchorOrderId is required" }, { status: 400 });
    }

    const rawItems = Array.isArray(body.items) ? body.items : [];
    const items = rawItems
      .map((row) => ({
        lineId: normalize(row?.lineId),
        sourceOrderId: normalize(row?.sourceOrderId),
        quantity: Math.max(0, Number(row?.quantity ?? 0)),
      }))
      .filter((row) => row.lineId && row.sourceOrderId && row.quantity > 0);
    if (items.length === 0) {
      return NextResponse.json({ ok: false, error: "At least one shipment line is required" }, { status: 400 });
    }

    const orderIds = Array.from(new Set(items.map((item) => item.sourceOrderId)));
    const orders = await prisma.galaxusOrder.findMany({
      where: { id: { in: orderIds } },
      include: { lines: true },
    });
    const orderById = new Map(orders.map((order) => [order.id, order]));
    const lineScopeById = new Map<string, boolean>();

    for (const orderId of orderIds) {
      const order = orderById.get(orderId);
      if (!order) {
        return NextResponse.json({ ok: false, error: `Order not found: ${orderId}` }, { status: 404 });
      }
      const gtinSet = await resolvePartnerGtins(
        collectGtinsFromLines(order.lines),
        access.providerKey
      );
      for (const line of order.lines) {
        lineScopeById.set(
          line.id,
          lineMatchesPartnerScope(line, access.providerKey, gtinSet)
        );
      }
    }

    for (const item of items) {
      if (!lineScopeById.get(item.lineId)) {
        return NextResponse.json(
          { ok: false, error: `Line ${item.lineId} is outside partner scope` },
          { status: 403 }
        );
      }
    }

    const result = await createCompositeWarehouseShipment({
      anchorOrderId,
      items,
      confirmReplace: Boolean(body.confirmReplace),
      trackingNumbers: body.trackingNumber ? [String(body.trackingNumber)] : undefined,
      carrierFinal: body.carrierFinal ?? null,
    });

    if (result.status === "error") {
      return NextResponse.json({ ok: false, error: result.message ?? "Composite shipment failed" }, { status: 400 });
    }

    const shipment = result.shipments[0] as any;
    const shipmentProviderKey = normalizeProviderKey(shipment?.providerKey ?? null);
    if (!shipmentProviderKey || shipmentProviderKey !== access.providerKey) {
      return NextResponse.json(
        { ok: false, error: "Created shipment provider does not match partner scope" },
        { status: 409 }
      );
    }

    await (prisma as any).orderStatusEvent
      .create({
        data: {
          orderId: shipment.orderId,
          source: "PARTNER_SHIPMENT",
          type: "CREATED",
          payloadJson: {
            shipmentId: shipment.id,
            dispatchNotificationId: shipment.dispatchNotificationId,
            partnerId: access.session.partnerId,
            partnerKey: access.providerKey,
            itemCount: items.length,
          },
        },
      })
      .catch(() => undefined);

    return NextResponse.json({
      ok: true,
      shipment: shipment
        ? {
            id: shipment.id,
            shipmentId: shipment.shipmentId,
            dispatchNotificationId: shipment.dispatchNotificationId,
            packageId: shipment.packageId,
            providerKey: shipment.providerKey,
            trackingNumber: shipment.trackingNumber,
            delrStatus: shipment.delrStatus,
          }
        : null,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to create composite shipment" },
      { status: 500 }
    );
  }
}
