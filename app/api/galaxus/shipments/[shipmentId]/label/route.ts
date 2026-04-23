import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { generateSsccLabelPdf } from "@/galaxus/labels/ssccLabel";
import { getStorageAdapter, getStorageAdapterForUrl } from "@/galaxus/storage/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ shipmentId: string }> }
) {
  try {
    const { shipmentId } = await params;
    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: { labelPdfUrl: true },
    });
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
    console.error("[GALAXUS][SHIPMENT][LABEL] Download failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ shipmentId: string }> }
) {
  try {
    const { shipmentId } = await params;
    const shipment = (await prisma.shipment.findUnique({
      where: { id: shipmentId },
      include: { order: true, items: { include: { order: true } } },
    })) as {
      id: string;
      order: import("@prisma/client").GalaxusOrder | null;
      packageId?: string | null;
      labelZpl?: string | null;
      labelPdfUrl?: string | null;
      shipmentId?: string | null;
      dispatchNotificationId?: string | null;
      items?: Array<{ order?: import("@prisma/client").GalaxusOrder | null }>;
    } | null;
    if (!shipment || !shipment.order) {
      return NextResponse.json({ ok: false, error: "Shipment not found" }, { status: 404 });
    }
    if (!shipment.packageId) {
      return NextResponse.json({ ok: false, error: "Missing SSCC package id" }, { status: 400 });
    }

    const itemOrderNumbers = Array.from(
      new Set(
        (shipment.items ?? [])
          .map((item) => item.order?.orderNumber ?? item.order?.galaxusOrderId)
          .filter((v): v is string => typeof v === "string" && v.length > 0)
      )
    );
    const orderNumbers =
      itemOrderNumbers.length > 0
        ? itemOrderNumbers
        : [shipment.order.orderNumber ?? shipment.order.galaxusOrderId].filter(
            (v): v is string => typeof v === "string" && v.length > 0
          );
    const label = await generateSsccLabelPdf(shipment.order, shipment.packageId, {
      shipmentId: shipment.dispatchNotificationId ?? shipment.shipmentId ?? shipment.order.galaxusOrderId,
      orderNumbers,
    });
    const storage = getStorageAdapter();
    const key = `galaxus/${shipment.order.galaxusOrderId}/shipments/${shipment.id}/sscc-label.pdf`;
    const stored = await storage.uploadPdf(key, label.pdf);

    const updated = (await prisma.shipment.update({
      where: { id: shipmentId },
      data: {
        labelZpl: label.zpl,
        labelPdfUrl: stored.storageUrl,
        labelGeneratedAt: new Date(),
      } as unknown as Record<string, unknown>,
    })) as {
      id: string;
      labelPdfUrl?: string | null;
      labelZpl?: string | null;
    };

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
