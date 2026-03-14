import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ shipmentId: string }> }
) {
  try {
    const { shipmentId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      manualManaged?: boolean;
      markShipped?: boolean;
      trackingNumber?: string | null;
      carrierFinal?: string | null;
    };

    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: { id: true, status: true },
    });
    if (!shipment) {
      return NextResponse.json({ ok: false, error: "Shipment not found" }, { status: 404 });
    }

    const wantsManual = body.manualManaged === true;
    const clearManual = body.manualManaged === false;
    const isManualNow = String(shipment.status ?? "").toUpperCase() === "MANUAL";

    const trackingNumber = body.trackingNumber ? String(body.trackingNumber).trim() : "";
    const carrierFinal = body.carrierFinal ? String(body.carrierFinal).trim() : "";

    const data: Record<string, unknown> = {};
    if (wantsManual) data.status = "MANUAL";
    if (clearManual && isManualNow) data.status = null;
    if (carrierFinal) data.carrierFinal = carrierFinal;
    if (trackingNumber) data.trackingNumber = trackingNumber;
    if (body.markShipped) {
      data.shippedAt = new Date();
      if (!trackingNumber) {
        // keep existing trackingNumber if already set; otherwise leave empty
      }
    }

    const updated = await prisma.shipment.update({
      where: { id: shipmentId },
      data: data as any,
    });

    return NextResponse.json({ ok: true, shipment: updated });
  } catch (error: any) {
    console.error("[GALAXUS][SHIPMENT][MANUAL] Failed:", error);
    return NextResponse.json({ ok: false, error: error?.message ?? "Manual update failed" }, { status: 500 });
  }
}

