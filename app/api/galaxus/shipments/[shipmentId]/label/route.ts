import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { generateSsccLabelPdf } from "@/galaxus/labels/ssccLabel";
import { getStorageAdapter } from "@/galaxus/storage/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: { shipmentId: string } }
) {
  try {
    const shipmentId = params.shipmentId;
    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      include: { order: true },
    });
    if (!shipment || !shipment.order) {
      return NextResponse.json({ ok: false, error: "Shipment not found" }, { status: 404 });
    }
    if (!shipment.packageId) {
      return NextResponse.json({ ok: false, error: "Missing SSCC package id" }, { status: 400 });
    }

    const label = await generateSsccLabelPdf(shipment.order, shipment.packageId);
    const storage = getStorageAdapter();
    const key = `galaxus/${shipment.order.galaxusOrderId}/shipments/${shipment.id}/sscc-label.pdf`;
    const stored = await storage.uploadPdf(key, label.pdf);

    const updated = await prisma.shipment.update({
      where: { id: shipment.id },
      data: {
        labelZpl: label.zpl,
        labelPdfUrl: stored.storageUrl,
        labelGeneratedAt: new Date(),
      },
    });

    return NextResponse.json({
      ok: true,
      shipmentId: updated.id,
      labelPdfUrl: updated.labelPdfUrl,
      labelZpl: updated.labelZpl,
    });
  } catch (error: any) {
    console.error("[GALAXUS][SHIPMENT][LABEL] Failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
