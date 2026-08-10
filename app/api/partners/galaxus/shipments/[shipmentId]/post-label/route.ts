import { NextRequest, NextResponse } from "next/server";
import {
  applySuccessfulSwissPostLabelToShipment,
  requestSwissPostLabelForOrderWithTrackingHint,
  resolveExistingFulfilledPostLabelResponse,
} from "@/galaxus/directDelivery/swissPostLabelFlow";
import { requirePartnerSelfFulfillAccess } from "@/app/api/partners/galaxus/_auth";
import { loadPartnerShipment } from "@/app/api/partners/galaxus/shipments/_utils";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ shipmentId: string }> }
) {
  try {
    const auth = await requirePartnerSelfFulfillAccess(request);
    if (!auth.access) return auth.response!;
    const access = auth.access;

    const { shipmentId } = await params;
    const shipment = await loadPartnerShipment(shipmentId, access.providerKey);
    if (!shipment || !shipment.order) {
      return NextResponse.json({ ok: false, error: "Shipment not found" }, { status: 404 });
    }

    const existing = await resolveExistingFulfilledPostLabelResponse(shipmentId, {
      documentUrlBase: "/api/partners/galaxus/documents",
    });
    if (existing) {
      return NextResponse.json({
        ok: true,
        url: existing.url,
        version: existing.version,
        delr: existing.delr,
        ordr: existing.ordr,
        trackingNumber: existing.trackingNumber,
        alreadyFulfilled: true,
      });
    }

    const body = (await request.json().catch(() => ({}))) as { trackingNumber?: string };
    const trackingNumber =
      String(body?.trackingNumber ?? "").trim() ||
      String(shipment.trackingNumber ?? shipment.order.galaxusOrderId ?? "").trim() ||
      `GALAXUS-${shipment.id}`;

    const swissRes = await requestSwissPostLabelForOrderWithTrackingHint(shipment.order, trackingNumber);
    if (!swissRes.ok) {
      return NextResponse.json(
        { ok: false, error: "Swiss Post label generation failed", swissPost: swissRes.data },
        { status: 502 }
      );
    }

    const result = await applySuccessfulSwissPostLabelToShipment(shipmentId, swissRes.data, {
      documentUrlBase: "/api/partners/galaxus/documents",
      delrActor: {
        type: "partner",
        partnerId: access.session.partnerId,
        partnerKey: access.session.partnerKey,
      },
    });
    await (prisma as any).orderStatusEvent
      .create({
        data: {
          orderId: shipment.orderId,
          source: "PARTNER_LABEL",
          type: "UPDATED",
          payloadJson: {
            shipmentId: shipment.id,
            partnerId: access.session.partnerId,
            partnerKey: access.providerKey,
            trackingNumber: result.trackingNumber,
          },
        },
      })
      .catch(() => undefined);
    return NextResponse.json({
      ok: true,
      url: result.url,
      version: result.version,
      delr: result.delr,
      ordr: result.ordr,
      trackingNumber: result.trackingNumber,
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message ?? "Failed to generate label" }, { status: 500 });
  }
}
