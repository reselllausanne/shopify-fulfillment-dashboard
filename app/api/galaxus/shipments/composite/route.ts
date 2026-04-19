import { NextResponse } from "next/server";
import { createCompositeWarehouseShipment } from "@/galaxus/warehouse/shipments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  anchorOrderId?: string;
  items?: Array<{ lineId?: string; sourceOrderId?: string; quantity?: number }>;
  confirmReplace?: boolean;
  trackingNumber?: string | null;
  carrierFinal?: string | null;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Body;
    const anchorOrderId = String(body?.anchorOrderId ?? "").trim();
    if (!anchorOrderId) {
      return NextResponse.json({ ok: false, error: "anchorOrderId is required" }, { status: 400 });
    }
    const items = Array.isArray(body.items) ? body.items : [];
    const mapped = items
      .map((row) => ({
        lineId: String(row?.lineId ?? "").trim(),
        sourceOrderId: String(row?.sourceOrderId ?? "").trim(),
        quantity: Math.max(0, Number(row?.quantity ?? 0)),
      }))
      .filter((row) => row.lineId && row.sourceOrderId && row.quantity > 0);

    if (mapped.length === 0) {
      return NextResponse.json({ ok: false, error: "At least one item { lineId, sourceOrderId, quantity }" }, { status: 400 });
    }

    const result = await createCompositeWarehouseShipment({
      anchorOrderId,
      items: mapped,
      confirmReplace: Boolean(body.confirmReplace),
      trackingNumbers: body.trackingNumber ? [String(body.trackingNumber)] : undefined,
      carrierFinal: body.carrierFinal ?? null,
    });

    if (result.status === "error") {
      return NextResponse.json(
        { ok: false, error: result.message ?? "Composite shipment failed" },
        { status: 400 }
      );
    }

    const s = result.shipments[0] as any;
    return NextResponse.json({
      ok: true,
      shipment: s
        ? {
            id: s.id,
            orderId: s.orderId,
            shipmentId: s.shipmentId,
            dispatchNotificationId: s.dispatchNotificationId,
            packageId: s.packageId,
            providerKey: s.providerKey,
            trackingNumber: s.trackingNumber,
            delrStatus: s.delrStatus,
          }
        : null,
    });
  } catch (error: any) {
    console.error("[GALAXUS][COMPOSITE_SHIPMENT]", error);
    return NextResponse.json({ ok: false, error: error?.message ?? "Failed" }, { status: 500 });
  }
}
