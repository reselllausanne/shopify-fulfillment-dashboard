import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { createShipmentsForOrder } from "@/galaxus/warehouse/shipments";
import {
  applySuccessfulSwissPostLabelToShipment,
  deleteDraftShipmentsForOrder,
  requestSwissPostLabelForGalaxusOrder,
} from "@/galaxus/directDelivery/swissPostLabelFlow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const { orderId } = await params;
    const order = await prisma.galaxusOrder.findFirst({
      where: { OR: [{ id: orderId }, { galaxusOrderId: orderId }] },
      include: { lines: true, shipments: { select: { id: true, delrSentAt: true, delrStatus: true } } },
    });
    if (!order) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }
    if (String(order.deliveryType ?? "").toLowerCase() !== "direct_delivery") {
      return NextResponse.json({ ok: false, error: "Order is not direct_delivery" }, { status: 400 });
    }

    const alreadyFulfilled = (order.shipments ?? []).some(
      (s) =>
        Boolean(s.delrSentAt) || String(s.delrStatus ?? "").toUpperCase() === "UPLOADED"
    );
    if (alreadyFulfilled) {
      return NextResponse.json(
        { ok: false, error: "Order already has a finalized shipment (DELR sent)" },
        { status: 409 }
      );
    }

    const removedDrafts = await deleteDraftShipmentsForOrder(order.id);

    const swissRes = await requestSwissPostLabelForGalaxusOrder(order);
    if (!swissRes.ok) {
      return NextResponse.json(
        { ok: false, error: "Swiss Post label generation failed", swissPost: swissRes.data },
        { status: 502 }
      );
    }

    const created = await createShipmentsForOrder({
      orderId: order.id,
      allowSplit: true,
      maxPairsPerParcel: 1,
      deliveryType: "direct_delivery",
    });

    if (created.status === "skipped") {
      return NextResponse.json(
        {
          ok: false,
          error: created.message ?? "Shipments already exist (unexpected after draft cleanup)",
          swissPostOk: true,
        },
        { status: 409 }
      );
    }
    if (created.status === "error" || !created.shipments?.length) {
      return NextResponse.json(
        {
          ok: false,
          error: created.message ?? "Create shipments failed after Swiss Post label succeeded",
          swissPostOk: true,
        },
        { status: 500 }
      );
    }

    const first = created.shipments[0];
    let result;
    try {
      result = await applySuccessfulSwissPostLabelToShipment(first.id, swissRes.data);
    } catch (persistErr: any) {
      console.error("[GALAXUS][DIRECT-SWISS-POST-LABEL] Persist after label failed:", persistErr);
      return NextResponse.json(
        {
          ok: false,
          error: persistErr?.message ?? "Failed to persist label after Swiss Post success",
          swissPostOk: true,
          shipmentId: first.id,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      removedDraftShipments: removedDrafts,
      createShipmentsStatus: created.status,
      url: result.url,
      version: result.version,
      delr: result.delr,
      ordr: result.ordr,
      trackingNumber: result.trackingNumber,
      shipmentId: first.id,
    });
  } catch (error: any) {
    console.error("[GALAXUS][DIRECT-SWISS-POST-LABEL] Failed:", error);
    return NextResponse.json({ ok: false, error: error?.message ?? "Failed" }, { status: 500 });
  }
}
