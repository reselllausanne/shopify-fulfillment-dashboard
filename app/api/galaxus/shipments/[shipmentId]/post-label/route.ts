import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import {
  applySuccessfulSwissPostLabelToShipment,
  requestSwissPostLabelForOrderWithTrackingHint,
} from "@/galaxus/directDelivery/swissPostLabelFlow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ shipmentId: string }> }
) {
  try {
    const { shipmentId } = await params;
    const shipment = await (prisma as any).shipment.findUnique({
      where: { id: shipmentId },
      include: { order: true },
    });
    if (!shipment || !shipment.order) {
      return NextResponse.json({ ok: false, error: "Shipment not found" }, { status: 404 });
    }
    const body = (await request.json().catch(() => ({}))) as { trackingNumber?: string };
    const trackingNumber = String(body?.trackingNumber ?? "").trim() ||
      String(shipment.trackingNumber ?? shipment.order.galaxusOrderId ?? "").trim() ||
      `GALAXUS-${shipment.id}`;

    const swissRes = await requestSwissPostLabelForOrderWithTrackingHint(shipment.order, trackingNumber);
    if (!swissRes.ok) {
      return NextResponse.json(
        { ok: false, error: "Swiss Post label generation failed", swissPost: swissRes.data },
        { status: 502 }
      );
    }

    try {
      const result = await applySuccessfulSwissPostLabelToShipment(shipmentId, swissRes.data);
      return NextResponse.json({
        ok: true,
        url: result.url,
        version: result.version,
        delr: result.delr,
        ordr: result.ordr,
        trackingNumber: result.trackingNumber,
      });
    } catch (applyErr: any) {
      const message = applyErr?.message ?? "Failed to persist label";
      if (message.includes("identCode")) {
        return NextResponse.json(
          { ok: false, error: message, swissPost: swissRes.data },
          { status: 502 }
        );
      }
      if (message.includes("missing content")) {
        return NextResponse.json(
          { ok: false, error: message, swissPost: swissRes.data },
          { status: 502 }
        );
      }
      throw applyErr;
    }
  } catch (error: any) {
    console.error("[GALAXUS][SHIPMENT][POST-LABEL] Failed:", error);
    return NextResponse.json({ ok: false, error: error?.message ?? "Failed to generate label" }, { status: 500 });
  }
}
