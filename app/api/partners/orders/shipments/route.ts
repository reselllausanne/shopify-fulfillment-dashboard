import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getPartnerSession(req);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const statusFilter = searchParams.get("status")?.trim() ?? "";
  const providerKey = normalizeProviderKey(session.partnerKey);
  if (!providerKey) {
    return NextResponse.json({ ok: false, error: "Invalid partner key" }, { status: 400 });
  }

  const shipments = await (prisma as any).shipment.findMany({
    where: {
      providerKey,
      ...(statusFilter ? { delrStatus: statusFilter } : {}),
    },
    include: {
      items: true,
      documents: true,
      order: {
        select: {
          id: true,
          galaxusOrderId: true,
          orderNumber: true,
          deliveryType: true,
          ordrSentAt: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const normalized = shipments.map((shipment: any) => {
    const deliveryNote = shipment.documents?.find((doc: any) => doc.type === "DELIVERY_NOTE");
    return {
      ...shipment,
      deliveryNotePdfUrl: deliveryNote?.storageUrl ?? null,
    };
  });

  return NextResponse.json({ ok: true, shipments: normalized });
}
