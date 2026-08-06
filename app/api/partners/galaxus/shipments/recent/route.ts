import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { DocumentType } from "@prisma/client";
import { requirePartnerSelfFulfillAccess } from "@/app/api/partners/galaxus/_auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function pickLatest(docs: Array<{ id: string; version: number | null; createdAt: Date }>) {
  if (!docs.length) return null;
  return docs
    .slice()
    .sort((a, b) => {
      const av = Number(a.version ?? 0);
      const bv = Number(b.version ?? 0);
      if (av !== bv) return bv - av;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    })[0];
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requirePartnerSelfFulfillAccess(request);
    if (!auth.access) return auth.response!;
    const access = auth.access;

    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? "20"), 1), 100);

    const shipments = await prisma.shipment.findMany({
      where: {
        providerKey: access.providerKey,
        order: { deliveryType: { not: "direct_delivery" } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        order: { select: { orderNumber: true, galaxusOrderId: true } },
        documents: { where: { type: { in: [DocumentType.DELIVERY_NOTE, DocumentType.LABEL] } } },
      },
    });

    const payload = shipments.map((shipment) => {
      const deliveryNotes = shipment.documents.filter((doc) => doc.type === DocumentType.DELIVERY_NOTE);
      const deliveryNote = pickLatest(deliveryNotes);
      const labelDocs = shipment.documents.filter((doc) => doc.type === DocumentType.LABEL);
      const ssccLabelDoc = pickLatest(
        labelDocs.filter((doc) => typeof doc.storageUrl === "string" && !doc.storageUrl.includes("shipping-labels"))
      );
      const shippingLabelDoc = pickLatest(
        labelDocs.filter((doc) => typeof doc.storageUrl === "string" && doc.storageUrl.includes("shipping-labels"))
      );
      return {
        id: shipment.id,
        shipmentId: shipment.shipmentId,
        dispatchNotificationId: shipment.dispatchNotificationId ?? null,
        createdAt: shipment.createdAt,
        delrStatus: shipment.delrStatus ?? null,
        orderNumber: shipment.order?.orderNumber ?? null,
        galaxusOrderId: shipment.order?.galaxusOrderId ?? null,
        ssccLabelUrl: ssccLabelDoc
          ? `/api/partners/galaxus/documents/${ssccLabelDoc.id}`
          : shipment.labelPdfUrl
            ? `/api/partners/galaxus/shipments/${shipment.id}/label`
            : null,
        deliveryNoteUrl: deliveryNote ? `/api/partners/galaxus/documents/${deliveryNote.id}` : null,
        shippingLabelUrl: shippingLabelDoc
          ? `/api/partners/galaxus/documents/${shippingLabelDoc.id}`
          : null,
      };
    });

    return NextResponse.json({ ok: true, shipments: payload });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message ?? "Failed" }, { status: 500 });
  }
}
