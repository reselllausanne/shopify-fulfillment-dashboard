import { NextResponse } from "next/server";
import { createShipmentsForOrder } from "@/galaxus/warehouse/shipments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const { orderId } = await params;
    const result = await createShipmentsForOrder({
      orderId,
      allowSplit: true,
      maxPairsPerParcel: 1,
      deliveryType: "direct_delivery",
    });
    if (result.status === "error") {
      return NextResponse.json(
        { ok: false, error: result.message ?? "Create shipments failed" },
        { status: 400 }
      );
    }
    const sanitized = result.shipments.map((shipment: any) => ({
      id: shipment.id,
      orderId: shipment.orderId,
      providerKey: shipment.providerKey ?? null,
      shipmentId: shipment.shipmentId ?? null,
      dispatchNotificationId: shipment.dispatchNotificationId ?? null,
      dispatchNotificationCreatedAt: shipment.dispatchNotificationCreatedAt ?? null,
      deliveryType: shipment.deliveryType ?? null,
      carrierFinal: shipment.carrierFinal ?? null,
      trackingNumber: shipment.trackingNumber ?? null,
      shippedAt: shipment.shippedAt ?? null,
      delrStatus: shipment.delrStatus ?? null,
      delrSentAt: shipment.delrSentAt ?? null,
      delrFileName: shipment.delrFileName ?? null,
      delrError: shipment.delrError ?? null,
      createdAt: shipment.createdAt ?? null,
      updatedAt: shipment.updatedAt ?? null,
    }));
    return NextResponse.json({ ok: true, shipments: sanitized, status: result.status });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Create shipments failed" },
      { status: 500 }
    );
  }
}
