import { NextRequest, NextResponse } from "next/server";
import { DocumentType } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { DocumentService } from "@/galaxus/documents/DocumentService";
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
    if (!shipment) {
      return NextResponse.json({ ok: false, error: "Shipment not found" }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const force = ["1", "true", "yes"].includes((searchParams.get("force") ?? "").toLowerCase());
    const formatParam = (searchParams.get("format") ?? "").toLowerCase();
    const forceDeliveryNoteFormat =
      formatParam === "direct" ? "direct" : formatParam === "warehouse" ? "warehouse" : undefined;

    if (!force && !forceDeliveryNoteFormat) {
      const existing = await prisma.document.findFirst({
        where: { shipmentId, type: DocumentType.DELIVERY_NOTE },
        orderBy: { version: "desc" },
      });
      if (existing) {
        return NextResponse.json({
          ok: true,
          documentId: existing.id,
          url: `/api/partners/galaxus/documents/${existing.id}`,
        });
      }
    }

    const service = new DocumentService();
    const documents = await service.generateForShipment({
      shipmentId,
      types: [DocumentType.DELIVERY_NOTE],
      forceDeliveryNoteFormat,
    });
    const created = documents.find((doc) => doc.type === DocumentType.DELIVERY_NOTE) ?? documents[0];
    if (!created) {
      return NextResponse.json({ ok: false, error: "Delivery note not generated" }, { status: 500 });
    }
    return NextResponse.json({
      ok: true,
      documentId: created.id,
      url: `/api/partners/galaxus/documents/${created.id}`,
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message ?? "Failed" }, { status: 500 });
  }
}
