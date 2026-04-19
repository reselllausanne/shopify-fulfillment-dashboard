import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { createShipmentsForOrder } from "@/galaxus/warehouse/shipments";
import { uploadDelrForShipment } from "@/galaxus/warehouse/delr";
import { deductStockForPartnerOrderFulfillment } from "@/galaxus/partners/partnerOrderStock";
import { requestFeedPush } from "@/galaxus/ops/feedPipeline";
import { resolveAppOriginForPartnerJobs } from "@/app/lib/partnerJobOrigin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ partnerOrderId: string }> }
) {
  try {
    const session = await getPartnerSession(request);
    if (!session) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { partnerOrderId } = await params;
    const body = await request.json().catch(() => ({}));
    const trackingNumber = body?.trackingNumber ? String(body.trackingNumber) : null;
    const trackingUrl = body?.trackingUrl ? String(body.trackingUrl) : null;
    const trackingNumbers = Array.isArray(body?.trackingNumbers)
      ? body.trackingNumbers.map((value: any) => String(value))
      : trackingNumber
        ? [trackingNumber]
        : undefined;

    const partnerOrder = await (prisma as any).partnerOrder.findFirst({
      where: { id: partnerOrderId, partnerId: session.partnerId },
    });
    if (!partnerOrder) {
      return NextResponse.json({ ok: false, error: "Partner order not found" }, { status: 404 });
    }

    const previousStatus = partnerOrder.status;

    const galaxusOrder = await prisma.galaxusOrder.findFirst({
      where: { galaxusOrderId: partnerOrder.galaxusOrderId },
    });
    if (!galaxusOrder) {
      return NextResponse.json({ ok: false, error: "Galaxus order not found" }, { status: 404 });
    }

    await (prisma as any).partnerOrder.update({
      where: { id: partnerOrder.id },
      data: {
        status: "FULFILLED",
        confirmedAt: new Date(),
        trackingNumber,
        trackingUrl,
      },
    });

    const shipmentsResult = await createShipmentsForOrder({
      orderId: galaxusOrder.id,
      trackingNumbers,
      carrierRaw: body?.carrierRaw ?? "partner",
      carrierFinal: body?.carrierFinal ?? null,
      shippedAt: body?.shippedAt ? new Date(body.shippedAt) : new Date(),
      force: Boolean(body?.force),
    });

    const delrResults = [];
    for (const shipment of shipmentsResult.shipments ?? []) {
      delrResults.push(await uploadDelrForShipment(shipment.id, { force: Boolean(body?.forceDelr) }));
    }

    const partnerKeyLower = String(session.partnerKey ?? "").toLowerCase();
    const stockResult = await deductStockForPartnerOrderFulfillment({
      partnerOrderId: partnerOrder.id,
      partnerKeyLower,
      previousStatus,
    });
    if (stockResult.adjusted > 0) {
      const origin = resolveAppOriginForPartnerJobs(new URL(request.url).origin);
      if (origin) {
        await requestFeedPush({ origin, scope: "full", triggerSource: "partner-order-fulfilled", runNow: true });
      }
    }

    return NextResponse.json({
      ok: true,
      partnerOrderId: partnerOrder.id,
      shipments: shipmentsResult,
      delrResults,
      stock: {
        adjustedRows: stockResult.adjusted,
        skipped: stockResult.skipped,
        details: stockResult.details,
      },
    });
  } catch (error: any) {
    console.error("[PARTNER][ORDER][CONFIRM] Failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
