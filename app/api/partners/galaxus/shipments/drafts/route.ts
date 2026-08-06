import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { requirePartnerSelfFulfillAccess } from "@/app/api/partners/galaxus/_auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const auth = await requirePartnerSelfFulfillAccess(request);
    if (!auth.access) return auth.response!;
    const access = auth.access;

    const drafts = await prisma.shipment.findMany({
      where: {
        providerKey: access.providerKey,
        status: "MANUAL",
        delrSentAt: null,
        OR: [{ delrStatus: null }, { delrStatus: "PENDING" }, { delrStatus: "ERROR" }],
        order: {
          archivedAt: null,
          cancelledAt: null,
          deliveryType: { not: "direct_delivery" },
        },
      },
      include: {
        order: true,
        items: { include: { order: true } },
        documents: true,
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    const payload = drafts.map((shipment) => {
      const orderNumbers = Array.from(
        new Set(
          (shipment.items ?? [])
            .map((item: any) => item.order?.orderNumber ?? item.order?.galaxusOrderId)
            .filter(Boolean)
        )
      );
      const deliveryNoteDoc = shipment.documents
        .filter((doc) => doc.type === "DELIVERY_NOTE")
        .sort((a, b) => Number(b.version ?? 0) - Number(a.version ?? 0))[0];
      const shippingLabelDoc = shipment.documents
        .filter((doc) => doc.type === "LABEL" && String(doc.storageUrl ?? "").includes("shipping-labels"))
        .sort((a, b) => Number(b.version ?? 0) - Number(a.version ?? 0))[0];

      return {
        id: shipment.id,
        shipmentId: shipment.shipmentId,
        dispatchNotificationId: shipment.dispatchNotificationId ?? null,
        packageId: shipment.packageId ?? null,
        trackingNumber: shipment.trackingNumber ?? null,
        delrStatus: shipment.delrStatus ?? null,
        createdAt: shipment.createdAt,
        orderNumbers,
        itemCount: (shipment.items ?? []).length,
        anchorOrderId: shipment.orderId ?? null,
        anchorOrderNumber: shipment.order?.orderNumber ?? shipment.order?.galaxusOrderId ?? null,
        ssccLabelUrl: shipment.labelPdfUrl ? `/api/partners/galaxus/shipments/${shipment.id}/label` : null,
        deliveryNoteUrl: deliveryNoteDoc ? `/api/partners/galaxus/documents/${deliveryNoteDoc.id}` : null,
        shippingLabelUrl: shippingLabelDoc ? `/api/partners/galaxus/documents/${shippingLabelDoc.id}` : null,
      };
    });

    return NextResponse.json({ ok: true, drafts: payload });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message ?? "Failed" }, { status: 500 });
  }
}
