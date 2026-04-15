import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { DocumentType } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RecentShipment = {
  id: string;
  shipmentId: string;
  dispatchNotificationId: string | null;
  createdAt: Date;
  delrStatus: string | null;
  orderNumber: string | null;
  galaxusOrderId: string | null;
  ssccLabelUrl: string | null;
  deliveryNoteUrl: string | null;
};

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

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? "10"), 1), 50);

    const shipments = await prisma.shipment.findMany({
      where: {
        order: { deliveryType: { not: "direct_delivery" } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        order: { select: { orderNumber: true, galaxusOrderId: true } },
        documents: { where: { type: { in: [DocumentType.DELIVERY_NOTE, DocumentType.LABEL] } } },
      },
    });

    const payload: RecentShipment[] = shipments.map((shipment) => {
      const deliveryNotes = shipment.documents.filter((doc) => doc.type === DocumentType.DELIVERY_NOTE);
      const deliveryNote = pickLatest(deliveryNotes);
      const labelDocs = shipment.documents.filter((doc) => doc.type === DocumentType.LABEL);
      const ssccLabelDoc = pickLatest(
        labelDocs.filter((doc) => typeof doc.storageUrl === "string" && !doc.storageUrl.includes("shipping-labels"))
      );
      const deliveryNoteUrl = deliveryNote ? `/api/galaxus/documents/${deliveryNote.id}` : null;
      const ssccLabelUrl = ssccLabelDoc
        ? `/api/galaxus/documents/${ssccLabelDoc.id}`
        : shipment.labelPdfUrl
          ? `/api/galaxus/shipments/${shipment.id}/label`
          : null;
      return {
        id: shipment.id,
        shipmentId: shipment.shipmentId,
        dispatchNotificationId: shipment.dispatchNotificationId ?? null,
        createdAt: shipment.createdAt,
        delrStatus: shipment.delrStatus ?? null,
        orderNumber: shipment.order?.orderNumber ?? null,
        galaxusOrderId: shipment.order?.galaxusOrderId ?? null,
        ssccLabelUrl,
        deliveryNoteUrl,
      };
    });

    return NextResponse.json({ ok: true, shipments: payload });
  } catch (error: any) {
    console.error("[GALAXUS][WAREHOUSE][RECENT] Failed:", error);
    return NextResponse.json({ ok: false, error: error?.message ?? "Failed" }, { status: 500 });
  }
}
