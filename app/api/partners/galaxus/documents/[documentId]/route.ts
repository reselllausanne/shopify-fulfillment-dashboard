import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getStorageAdapterForUrl } from "@/galaxus/storage/storage";
import { getPartnerSession, isPartnerRoleAllowed } from "@/app/lib/partnerAuth";
import { isPartnerSelfFulfillEnabled } from "@/app/lib/partnerSelfFulfill";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  const session = await getPartnerSession(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!isPartnerRoleAllowed(session.role)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  if (!isPartnerSelfFulfillEnabled(session.partnerKey)) {
    return NextResponse.json({ ok: false, error: "Partner self-fulfill disabled" }, { status: 403 });
  }

  const providerKey = normalizeProviderKey(session.partnerKey);
  if (!providerKey) {
    return NextResponse.json({ ok: false, error: "Invalid partner key" }, { status: 400 });
  }

  const { documentId } = await params;
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: {
      shipment: {
        select: { providerKey: true },
      },
    },
  });

  if (!document || !document.shipment) {
    return NextResponse.json({ ok: false, error: "Document not found" }, { status: 404 });
  }

  const shipmentProviderKey = normalizeProviderKey(document.shipment.providerKey ?? null);
  if (!shipmentProviderKey || shipmentProviderKey !== providerKey) {
    return NextResponse.json({ ok: false, error: "Document not found" }, { status: 404 });
  }

  const storage = getStorageAdapterForUrl(document.storageUrl);
  const file = await storage.getPdf(document.storageUrl);
  const filename = `${document.type.toLowerCase()}-v${document.version}.pdf`;
  return new Response(file.content as unknown as BodyInit, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${filename}"`,
      "content-length": String(file.content.length ?? 0),
    },
  });
}
