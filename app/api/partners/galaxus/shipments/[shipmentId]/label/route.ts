import { NextRequest, NextResponse } from "next/server";
import { generateSsccLabelPdf } from "@/galaxus/labels/ssccLabel";
import { getStorageAdapter, getStorageAdapterForUrl } from "@/galaxus/storage/storage";
import { prisma } from "@/app/lib/prisma";
import { requirePartnerSelfFulfillAccess } from "@/app/api/partners/galaxus/_auth";
import { loadPartnerShipment } from "@/app/api/partners/galaxus/shipments/_utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ shipmentId: string }> }
) {
  try {
    const auth = await requirePartnerSelfFulfillAccess(request);
    if (!auth.access) return auth.response!;
    const access = auth.access;

    const { shipmentId } = await params;
    const shipment = await loadPartnerShipment(shipmentId, access.providerKey);
    if (!shipment?.labelPdfUrl) {
      return NextResponse.json({ ok: false, error: "Label not found" }, { status: 404 });
    }
    const storage = getStorageAdapterForUrl(shipment.labelPdfUrl);
    const file = await storage.getPdf(shipment.labelPdfUrl);
    return new Response(file.content as unknown as BodyInit, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="sscc-label.pdf"`,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message ?? "Failed" }, { status: 500 });
  }
}

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
    if (!shipment.packageId) {
      return NextResponse.json({ ok: false, error: "Missing SSCC package id" }, { status: 400 });
    }

    const label = await generateSsccLabelPdf(shipment.order, shipment.packageId, {
      shipmentId: shipment.dispatchNotificationId ?? shipment.shipmentId ?? shipment.order.galaxusOrderId,
      orderNumbers: [shipment.order.orderNumber ?? shipment.order.galaxusOrderId].filter(Boolean),
    });
    const storage = getStorageAdapter();
    const key = `galaxus/${shipment.order.galaxusOrderId}/shipments/${shipment.id}/sscc-label.pdf`;
    const stored = await storage.uploadPdf(key, label.pdf);
    const updated = await prisma.shipment.update({
      where: { id: shipmentId },
      data: {
        labelZpl: label.zpl,
        labelPdfUrl: stored.storageUrl,
        labelGeneratedAt: new Date(),
      } as any,
    });
    return NextResponse.json({
      ok: true,
      shipmentId: updated.id,
      labelPdfUrl: `/api/partners/galaxus/shipments/${updated.id}/label`,
      labelZpl: updated.labelZpl,
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message ?? "Failed" }, { status: 500 });
  }
}
