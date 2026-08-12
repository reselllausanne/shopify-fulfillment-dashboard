import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { prisma } from "@/app/lib/prisma";
import {
  applySuccessfulSwissPostLabelToShipment,
  requestSwissPostLabelForOrderWithTrackingHint,
  resolveExistingFulfilledPostLabelResponse,
} from "@/galaxus/directDelivery/swissPostLabelFlow";
import { getStaffRoleFromRequest } from "@/app/lib/staffAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ shipmentId: string }> }
) {
  try {
    const staffRole = await getStaffRoleFromRequest(request);
    if (!staffRole) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const { shipmentId } = await params;
    const shipment = await (prisma as any).shipment.findUnique({
      where: { id: shipmentId },
      include: { order: true },
    });
    if (!shipment || !shipment.order) {
      return NextResponse.json({ ok: false, error: "Shipment not found" }, { status: 404 });
    }

    const existing = await resolveExistingFulfilledPostLabelResponse(shipmentId);
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
    const trackingNumber = String(body?.trackingNumber ?? "").trim() ||
      String(shipment.trackingNumber ?? shipment.order.galaxusOrderId ?? "").trim() ||
      `GALAXUS-${shipment.id}`;

    const startedAt = Date.now();
    const swissRes = await requestSwissPostLabelForOrderWithTrackingHint(shipment.order, trackingNumber);
    console.log("[GALAXUS][SHIPMENT][POST-LABEL] swiss post", {
      shipmentId,
      ok: swissRes.ok,
      status: swissRes.status,
      ms: Date.now() - startedAt,
    });
    if (!swissRes.ok) {
      return NextResponse.json(
        { ok: false, error: "Swiss Post label generation failed", swissPost: swissRes.data },
        { status: 502 }
      );
    }

    try {
      const persistStartedAt = Date.now();
      const result = await applySuccessfulSwissPostLabelToShipment(shipmentId, swissRes.data);
      console.log("[GALAXUS][SHIPMENT][POST-LABEL] persist", {
        shipmentId,
        trackingNumber: result.trackingNumber,
        delrStatus: result.delr?.status ?? null,
        ms: Date.now() - persistStartedAt,
        totalMs: Date.now() - startedAt,
      });
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
    const message = String(error?.message ?? "Failed to generate label");
    const status = /unreachable|timeout|fetch failed/i.test(message) ? 502 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
